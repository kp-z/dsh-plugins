/**
 * 地点 id → 场景资源键。
 *
 * 两套 id 不能混：
 * - presence.location 用 place:*（世界语义）；
 * - snapshot.scene / presence.scene / scene_state.payload.scene 用「地图资源键」
 *   （company、home_public…）——前端拿它去 /assets/maps/<key>/ 找图，也给 Phaser 当初始场景键。
 *
 * 用错的表现很具体：画布建起来了，但 background.png 一次都不请求。
 */
const SCENE_KEY: Record<string, string> = {
  'place:office.tech_company_1': 'company',
  'place:residential.apartment_1': 'home_public',
  'place:residential.mini_market': 'convenience_store',
  'place:commercial.city_restaurant': 'restaurant',
  'place:downtown.city_gym': 'gym',
  'place:outdoor.sunset_beach': 'beach',
}

/** 把 place id 换成场景资源键；已经是键就原样返回。 */
export function sceneKeyOf(placeId: string): string {
  const mapped = SCENE_KEY[placeId]
  if (mapped !== undefined) return mapped
  return placeId.startsWith('place:') ? 'home_public' : placeId
}
