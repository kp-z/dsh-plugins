/**
 * dsh-dev-git-graph host entry：内置移植版 vscode-git-graph 1.30.0（MIT，© mhutchie）。
 * 1) webServer 挂两条路由：
 *    GET /dsh-dev-git-graph/gg/          -> git-graph 前端入口（iframe 加载，带 __DSH_GG_BOOT__）
 *    GET /dsh-dev-git-graph/gg/<static>  -> 打包后的 JS/CSS
 *    POST /dsh-dev-git-graph/gg/api      -> 原扩展 gitGraphView.respondToMessage 的命令集（host 直跑 git 命令）
 * 2) 数据层复用 vendor/git-graph/dataSource.ts（mhutchie/vscode-git-graph，许可见 vendor/git-graph/LICENSE）。
 *
 * 两条路由都在 handler 开头过 connection 的信任栅栏（requestRejection）：Host/Origin 检查 +
 * 浏览器登录凭据。少了这一步，非 loopback 部署下 /gg/api 就是未鉴权的 git 执行入口
 * （issue #1）。connection 服务不在时插件不挂路由（fail closed），不会裸奔。
 */
import type http from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { registerGgRoutes, type RouteFence } from './git-graph/routes.js';

export const name = 'dev-git-graph';
export const inject = ['webServer', 'connection'];

export interface DevGitGraphPluginConfig {}

interface WebServerLike {
	register(spec: {
		kind: 'exact' | 'prefix';
		path: string;
		handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
	}): () => void;
}

interface ConnectionLike {
	/** Connection 的 Host/Origin 栅栏 + 浏览器鉴权；undefined 表示放行。 */
	requestRejection(req: http.IncomingMessage): 401 | 403 | undefined;
}

export function apply(ctx: Context, config: Partial<DevGitGraphPluginConfig> = {}): void {
	void config;

	ctx.inject(['webServer', 'connection'], (host) => {
		const { webServer, connection } = host as unknown as {
			webServer: WebServerLike;
			connection: ConnectionLike;
		};
		const fence: RouteFence = (req) => connection.requestRejection(req);
		const disposers = registerGgRoutes(webServer, fence);

		(ctx.on as (event: string, cb: () => void) => void)('dispose', () => {
			for (const d of disposers) d();
		});
	});
}
