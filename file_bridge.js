#!/usr/bin/env node
const { createServer } = require('http')
const Querystring = require('querystring')

const PORT = 6666
const router = make_router()
const provider_manager = new function() {
  const map = new Map()
  return {
    set_provider(id, children) {
      if (!map.has(id))
        map.set(id, new Provider())
      map.get(id).set_children(children)
    }
  }

  /** 文件提供者 */
  class Provider {
    set_children(children) {
      this.children = children
    }
  }
}

let provider_id = 0

createServer(
  function handle(request, response) {
    try {
      console.log('receive request', request.url)
      const [path_target, querystring] = request.url.split('?')
      let { lang, ...query } = Querystring.parse(querystring)
      switch(lang) {
        case 'cn':
        case 'en':
          break
        case undefined: // 默认中文
          lang = 'cn'
          break
        default: // 遇到不支持的语言就使用英文
          lang = 'en'
          break
      }

      const handler = router.find(({ path, method = 'GET' }) => path == path_target && method == request.method)
      if(handler)
        handler.handle({
          res: response,
          lang_key: lang,
          query,
          success: () => response.end('success'),
          json: {
            read: () => new Promise((resolve, reject) => {
              const result = []
              request.on('data', chunk => result.push(chunk))
              request.on('end', () => resolve(JSON.parse(result.join(''))))
              request.on('error', reject)
            }),
            write: data => response.end(JSON.stringify(data))
          }
        })
      else {
        response.writeHead(404)
        response.end('404')
      }
    } catch (err) {
      console.error(err)
    }
  }
).listen(PORT,
  function on_server_started() {
    console.log('file bridge started on ', PORT)
  }
)

function make_router() {
  const lang = (cn, en) => ({ cn, en })
  const lang_common = {
    title: lang('文件桥', 'File Bridge'),
    title_: (lang, key) => lang_common.title[key] + ' ' + lang[key],
    lang_declaration: lang('zh', 'en'),
  }

  function respond_html(res, lang_key, title, body) {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf8' })
    res.end(`
      <!DOCTYPE html>
      <html lang='${lang_common.lang_declaration[lang_key]}'>
        <head>
          <title>${title}</title>
          <meta charset='utf8'>
        </head>
        <body>
          <h1>${title}</h1>
          ${body}
          <script>
            window.http = new Proxy({}, {
              get(_, method) {
                return (path, data) => fetch(path, {
                  method,
                  body: data && JSON.stringify(data)
                }).then(res => res.json())
              }
            })
          </script>
        </body>
      </html>
    `)
  }

  return [
    {
      path: '/',
      handle({ res, lang_key }) {
        respond_html(
          res,
          lang_key,
          lang_common.title[lang_key],
          `
            <p>
              ${lang('把这台电脑当作文件 ', 'This computor is a file ')[lang_key]}
              <a href='./as_server'>${lang('提供端', 'provider')[lang_key]}</a>
              ${lang('或者', 'or')[lang_key]}
              <a href='./as_client'>${lang('下载端', 'downloader')[lang_key]}</a>
            </p>
          `
        )
      }
    },
    {
      path: '/as_server',
      handle({ res, lang_key }) {
        respond_html(
          res,
          lang_key,
          lang_common.title_(lang('提供端', 'Provider'), lang_key),
          `
            <p>
              <button onclick="serve()">${lang('选择目录', 'Select a directory')[lang_key]}</button>
            </p>
            <p id="serve_tip"></p>
            <main></main>
            <style>
              main:not(:empty) {
                background: #00000008;
                padding: .58em .88em;
              }
              details {
                line-height: 1;
              }
              summary {
                cursor: pointer;
              }
              summary, .file_name {
                padding: .3em .5em;
              }
              .file_name::before {
                content: '# ';
                opacity: .5;
              }
              .details_body {
                padding: 0 1em;
              }
            </style>
            <script>
              let root = null
              let provider_id = ${++provider_id}
              async function serve() {
                const Proto = self => Object.assign(Object.create({
                  toJSON() {
                    return {
                      name: this.name,
                      children: this.children,
                    }
                  }
                }), self)
                const Dir = (handle, name) => Proto({
                  handle,
                  name,
                  children: []
                })
                const File = (handle, name) => Proto({ handle, name })

                // 1. 构建文件目录树
                root = await async function build_tree(dir) {
                  for await (const [name, handle] of dir.handle.entries())
                    dir.children.push(
                      await {
                        file: () => File(handle, name),
                        directory: () => build_tree(Dir(handle, name))
                      }[handle.kind]()
                    )
                  return dir
                }(
                  Dir(await window.showDirectoryPicker())
                )

                // 2. 填充提示信息
                document.getElementById('serve_tip').innerHTML = \`
                  ${lang('已开启，客户端访问', 'serving on')[lang_key]}
                  <a href="../as_client?id=\${provider_id}" target="_blank">
                    ${lang('这个链接', 'this link')[lang_key]}
                  </a>
                \`

                // 3. 展示文件目录树
                const main = document.querySelector('main')
                const build_details = (header, body) =>
                  '<details><summary>' + header + '</summary><div class="details_body">' + body + '</div></details>'
                main.innerHTML = function build_html(dir) {
                  return build_details(
                    '/' + dir.name,
                    dir.children.map(item => item.children
                      ? build_html(item)
                      : '<div class="file_name">' + item.name + '</div>'
                    ).join('')
                  )
                }({
                  name: '',
                  children: root.children
                })
                
                // 4. 上报服务器
                http.POST('/provider', {
                  provider_id,
                  children: root.children,
                })
              }
            </script>
          `
        )
      }
    },
    {
      path: '/provider',
      method: 'POST',
      async handle({ json, success }) {
        const { provider_id, children } = await json.read()
        provider_manager.set_provider(provider_id, children)
        success()
      }
    }
  ]
}