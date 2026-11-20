/**
 * Slow Vale 适配层出口（P0）。
 *
 * 只暴露三样东西：投影（纯函数，可单测）、HTTP 契约、bridge 生命周期。
 * 上层（index.ts）只依赖 createSlowvaleBridge，不需要知道内部有路由与静态服务。
 */
export { createSlowvaleBridge } from './server.js'
export type { Bridge, BridgeOptions } from './server.js'
export { projectScene, projectSnapshot, projectWorldCard, projectRoleCard, clockOf, placesOf } from './project.js'
export type { ProjectOptions } from './project.js'
export { SLOWVALE_PROTOCOL_VERSION } from './types.js'
export type { WorldLike, WorldAgentLike } from './types.js'
