/**
 * /gg 路由的信任栅栏测试（issue #1 的回归）。
 *
 * 存在的理由：这两条路由是直接挂在宿主 webServer 上的，宿主 register() 只入路由表、
 * 不做任何鉴权。插件若不在 handler 开头问一次 connection.requestRejection，
 * 非 loopback 部署下任何能连到端口的机器都能 POST /gg/api 跑 reset/clean/push。
 *
 * 这里用假 webServer 抓住 route，用假 req/res 断言：
 * - fence 返回 403/401 时，两条路由都直接拒绝，且不触达命令集；
 * - fence 放行时，原有行为不变（非 POST -> 405、未知静态 -> 404）；
 * - fence 每个请求都被问一次（不是注册时问一次）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type http from 'node:http'
import { registerGgRoutes } from '../lib/src/git-graph/routes.js'

interface FakeRoute {
	kind: 'exact' | 'prefix'
	path: string
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
}

function fakeServer() {
	const routes: FakeRoute[] = []
	return {
		routes,
		register(spec: FakeRoute) {
			routes.push(spec)
			return () => {
				const at = routes.indexOf(spec)
				if (at >= 0) routes.splice(at, 1)
			}
		},
	}
}

function fakeRes() {
	let status = 0
	let body = ''
	let headers: Record<string, unknown> = {}
	return {
		writeHead(code: number, h?: Record<string, unknown>) {
			status = code
			if (h) headers = h
			return this
		},
		end(chunk?: unknown) {
			if (chunk !== undefined && chunk !== null) body += String(chunk)
		},
		get status() { return status },
		get body() { return body },
		get headers() { return headers },
	}
}

function fakeReq(url: string, method = 'GET') {
	return { url, method, headers: {} } as unknown as http.IncomingMessage
}

function mount(fence: (req: http.IncomingMessage) => 401 | 403 | undefined) {
	const server = fakeServer()
	const disposers = registerGgRoutes(server as never, fence)
	const byKind = (kind: 'exact' | 'prefix') => {
		const route = server.routes.find((candidate) => candidate.kind === kind)
		if (!route) throw new Error('route not registered: ' + kind)
		return route
	}
	return {
		server,
		disposers,
		staticRoute: byKind('prefix'),
		apiRoute: byKind('exact'),
	}
}

function call(route: FakeRoute, req: http.IncomingMessage) {
	const res = fakeRes()
	route.handler(req, res as unknown as http.ServerResponse)
	return res
}

test('fence 拒绝时 /gg/api 直接 403，不触达命令集', () => {
	const { apiRoute } = mount(() => 403)
	const res = call(apiRoute, fakeReq('/dsh-dev-git-graph/gg/api', 'POST'))
	assert.equal(res.status, 403)
	assert.deepEqual(JSON.parse(res.body), { error: 'forbidden' })
})

test('fence 拒绝时 /gg/ 静态入口同样挡住（避免半残状态）', () => {
	const { staticRoute } = mount(() => 403)
	const res = call(staticRoute, fakeReq('/dsh-dev-git-graph/gg/?repo=/tmp'))
	assert.equal(res.status, 403)
	assert.equal(res.body, 'forbidden')
})

test('401 原样透传（宿主 disposed 时的拒绝码）', () => {
	const { apiRoute, staticRoute } = mount(() => 401)
	assert.equal(call(apiRoute, fakeReq('/dsh-dev-git-graph/gg/api', 'POST')).status, 401)
	assert.equal(call(staticRoute, fakeReq('/dsh-dev-git-graph/gg/')).body, 'unauthorized')
})

test('fence 放行时行为不变：非 POST 405、未知静态 404', () => {
	const { apiRoute, staticRoute } = mount(() => undefined)
	const api = call(apiRoute, fakeReq('/dsh-dev-git-graph/gg/api', 'GET'))
	assert.equal(api.status, 405)
	assert.equal(api.headers.allow, 'POST')

	const staticRes = call(staticRoute, fakeReq('/dsh-dev-git-graph/gg/nope.js?repo=/tmp'))
	assert.equal(staticRes.status, 404)
})

test('fence 按请求询问，而不是注册时问一次', () => {
	let asked = 0
	const { apiRoute } = mount(() => {
		asked += 1
		return 403
	})
	call(apiRoute, fakeReq('/dsh-dev-git-graph/gg/api', 'POST'))
	call(apiRoute, fakeReq('/dsh-dev-git-graph/gg/api', 'POST'))
	assert.equal(asked, 2)
})

test('disposer 能移除两条路由', () => {
	const { server, disposers } = mount(() => undefined)
	assert.equal(server.routes.length, 2)
	for (const dispose of disposers) dispose()
	assert.equal(server.routes.length, 0)
})
