import { net } from 'lib/net.js'
import { Loop } from 'lib/loop.js'
import { Timer } from 'lib/timer.js'
import { RequestParser } from 'lib/pico.js'
import { mem, cputime, colors } from '../lib/bench.mjs'
import * as html from './lib/html.mjs'

const { assert, core, getenv, ptr, utf8_encode_into_ptr } = lo
const { fcntl, O_NONBLOCK, F_SETFL, read_file } = core
const { 
  socket, bind, listen, accept, close, setsockopt, send2, recv2
} = net
const {
  SOCK_STREAM, AF_INET, SOMAXCONN, SO_REUSEPORT, SOL_SOCKET, SOCKADDR_LEN
} = net
const { sockaddr_in } = net.types
const { Blocked } = Loop
const { AC, AD, AY } = colors

function update_headers () {
  htmlx = `content-type: text/html;charset=utf-8\r\nDate: ${(new Date()).toUTCString()}\r\n`
}

function on_timer () {
  const [ usr, , sys ] = cputime()
  console.log(`${AC}rps${AD} ${rps} ${AC}rss${AD} ${mem()} ${AY}usr${AD} ${usr.toString().padStart(3, ' ')} ${AY}sys${AD}  ${sys.toString().padStart(3, ' ')} ${AY}tot${AD} ${(usr + sys).toString().padStart(3, ' ')}`)
  rps = 0
  update_headers()
}

function status_line (status = 200, message = 'OK') {
  return `HTTP/1.1 ${status} ${message}\r\n`
}

function close_socket (fd) {
  if (!sockets.has(fd)) return
  const socket = sockets.get(fd)
  if (fd > 0) {
    loop.remove(fd)
    if (sockets.has(fd)) sockets.delete(fd)
    close(fd)
    conn--
  }
  socket.fd = 0
}

function on_socket_event (fd) {
  const { parser } = sockets.get(fd)
  const bytes = recv2(fd, parser.rb.ptr, BUFSIZE, 0)
  if (bytes > 0) {
    const parsed = parser.parse(bytes)
    if (parsed > 0) {
      const body_size = utf8_encode_into_ptr(data_fn.call(data), body_start)
      const pre = `${status_line()}${htmlx}Content-Length: ${body_size}\r\n\r\n`
      const addr = body_start - pre.length
      send2(fd, addr, utf8_encode_into_ptr(pre, addr) + body_size)
      rps++
      return
    }
    if (parsed === -2) return
  }
  if (bytes < 0 && lo.errno === Blocked) return
  close_socket(fd)
}

function create_socket (fd) {
  return {
    parser: new RequestParser(new Uint8Array(BUFSIZE)), fd
  }
}

function on_socket_connect (sfd) {
  const fd = accept(sfd, 0, 0)
  if (fd > 0) {
    assert(fcntl(fd, F_SETFL, O_NONBLOCK) === 0)
    sockets.set(fd, create_socket(fd))
    assert(loop.add(fd, on_socket_event, Loop.Readable, close_socket) === 0)
    conn++
    return
  }
  if (lo.errno === Blocked) return
  close(fd)
}

function on_accept_error(fd, mask) {
  console.log(`accept error on socket ${fd} : ${mask}`)
}

function start_server (addr, port) {
  const fd = socket(AF_INET, SOCK_STREAM, 0)
  assert(fd > 2)
  assert(fcntl(fd, F_SETFL, O_NONBLOCK) === 0)
  assert(!setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, net.on, 32))
  assert(bind(fd, sockaddr_in(addr, port), SOCKADDR_LEN) === 0)
  assert(listen(fd, SOMAXCONN) === 0)
  assert(loop.add(fd, on_socket_connect, Loop.Readable, on_accept_error) === 0)
  return fd
}

let rps = 0
let conn = 0
const rows = parseInt(lo.args[2] || '10', 10)
const decoder = new TextDecoder()
const encoder = new TextEncoder()
const escape_html = false
const data = JSON.parse(decoder.decode(read_file('data.json'))).slice(0, rows)
const data_fn = html.compile(encoder.encode(`<!DOCTYPE html><html lang=en><body><table>{{#each this}}<tr><td>{{id}}</td><td>{{name}}</td></tr>{{/each}}</table></body></html>`), 'data', 'data', { rawStrings: false, escape: escape_html }).call
const send_buf = ptr(new Uint8Array(1 * 1024 * 1024))
const send_ptr = send_buf.ptr
const body_start = send_ptr + 4096
const _sockets = new Array(65536)
_sockets.fill(undefined)
const sockets = { get: fd => _sockets[fd], set: (fd, sock) => _sockets[fd] = sock, delete: fd => _sockets[fd] = null, has: fd => _sockets[fd] }
const BUFSIZE = 65536
const loop = new Loop()
let htmlx = 
  `Content-Type: text/html;charset=utf-8\r\nDate: ${(new Date()).toUTCString()}\r\n`
const timer = new Timer(loop, 1000, on_timer)
const address = getenv('ADDRESS') || '127.0.0.1'
const port = parseInt(getenv('PORT') || 6000, 10)
const fd = start_server(address, port)
while (loop.poll() > 0) lo.runMicroTasks()
timer.close()
close(fd)
