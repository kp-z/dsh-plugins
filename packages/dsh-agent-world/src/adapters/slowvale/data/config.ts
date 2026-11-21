/**
 * 运行时配置：**直接从线上服务端取下来的真实数据**。
 *
 * 这些键是前端硬校验的（少一个整块面板就崩），自己编一份永远填不对，
 * 所以这里保存官方原样：scene_by_place（14 条）、phone_apps（12 项且有顺序）、
 * phone_bank、phone_gacha、item_categories、proficiency_exp_thresholds…
 */
export const REAL_CONFIG = {
 "season_display": {
  "spring": {
   "icon": "🌸",
   "short": "春"
  },
  "summer": {
   "icon": "☀️",
   "short": "夏"
  },
  "autumn": {
   "icon": "🍂",
   "short": "秋"
  },
  "winter": {
   "icon": "❄️",
   "short": "冬"
  }
 },
 "weather_display": {
  "sunny": {
   "icon": "☀️",
   "short": "晴"
  },
  "cloudy": {
   "icon": "⛅",
   "short": "云"
  },
  "rainy": {
   "icon": "🌧️",
   "short": "雨"
  },
  "stormy": {
   "icon": "⛈️",
   "short": "暴雨"
  },
  "snowy": {
   "icon": "🌨️",
   "short": "雪"
  }
 },
 "item_type_display": {
  "ingredient": {
   "icon": "vegetable"
  },
  "food": {
   "icon": "food"
  },
  "alcohol": {
   "icon": "cocktail"
  },
  "medicine": {
   "icon": "medicine"
  },
  "clothing": {
   "icon": "clothing"
  },
  "appliance": {
   "icon": "plug"
  },
  "furniture": {
   "icon": "bed"
  },
  "card": {
   "icon": "gacha"
  },
  "collectible": {
   "icon": "star"
  },
  "daily_supply": {
   "icon": "supply"
  },
  "pet_tag": {
   "icon": "cat"
  },
  "misc": {
   "icon": "misc"
  }
 },
 "item_categories": [
  {
   "label": "食材",
   "value": "ingredient"
  },
  {
   "label": "食物",
   "value": "food"
  },
  {
   "label": "酒类",
   "value": "alcohol"
  },
  {
   "label": "药品",
   "value": "medicine"
  },
  {
   "label": "衣物",
   "value": "clothing"
  },
  {
   "label": "家具",
   "value": "furniture"
  },
  {
   "label": "家电",
   "value": "appliance"
  },
  {
   "label": "卡牌",
   "value": "card"
  },
  {
   "label": "收藏品",
   "value": "collectible"
  },
  {
   "label": "日用品",
   "value": "daily_supply"
  },
  {
   "label": "杂物",
   "value": "misc"
  },
  {
   "label": "宠物名牌",
   "value": "pet_tag"
  }
 ],
 "proficiency_exp_thresholds": {
  "singing": {
   "apprentice": 200,
   "skilled": 800,
   "proficient": 2400
  },
  "cooking": {
   "apprentice": 150,
   "skilled": 600,
   "proficient": 1800
  },
  "fitness": {
   "apprentice": 150,
   "skilled": 600,
   "proficient": 1800
  },
  "programming": {
   "apprentice": 50,
   "skilled": 200,
   "proficient": 600
  },
  "service": {
   "apprentice": 50,
   "skilled": 200,
   "proficient": 600
  },
  "farming": {
   "apprentice": 50,
   "skilled": 200,
   "proficient": 600
  },
  "fishing": {
   "apprentice": 50,
   "skilled": 200,
   "proficient": 600
  },
  "medical": {
   "apprentice": 50,
   "skilled": 200,
   "proficient": 600
  },
  "tailoring": {
   "apprentice": 50,
   "skilled": 200,
   "proficient": 600
  },
  "bartending": {
   "apprentice": 150,
   "skilled": 600,
   "proficient": 1800
  },
  "taming": {
   "apprentice": 50,
   "skilled": 200,
   "proficient": 600
  }
 },
 "craft_quality_rates": {
  "apprentice": [
   {
    "quality": "normal",
    "probability": 0.95
   },
   {
    "quality": "fine",
    "probability": 0.05
   },
   {
    "quality": "superior",
    "probability": 0.0
   }
  ],
  "skilled": [
   {
    "quality": "normal",
    "probability": 0.65
   },
   {
    "quality": "fine",
    "probability": 0.28
   },
   {
    "quality": "superior",
    "probability": 0.07
   }
  ],
  "proficient": [
   {
    "quality": "normal",
    "probability": 0.3
   },
   {
    "quality": "fine",
    "probability": 0.5
   },
   {
    "quality": "superior",
    "probability": 0.2
   }
  ],
  "master": [
   {
    "quality": "normal",
    "probability": 0.0
   },
   {
    "quality": "fine",
    "probability": 0.6
   },
   {
    "quality": "superior",
    "probability": 0.4
   }
  ]
 },
 "craft_quality_multipliers": {
  "normal": 1.0,
  "fine": 1.3,
  "superior": 1.6
 },
 "recipe_exp_rewards": {
  "0": 3,
  "1": 5,
  "2": 15,
  "3": 35,
  "4": 60
 },
 "fitness_venues": [
  {
   "venue": "gym",
   "exp_per_session": 5,
   "stamina_per_hour": 8.0,
   "satiety_per_hour": 6.0
  },
  {
   "venue": "home",
   "exp_per_session": 3,
   "stamina_per_hour": 8.0,
   "satiety_per_hour": 6.0
  },
  {
   "venue": "outdoor",
   "exp_per_session": 4,
   "stamina_per_hour": 8.0,
   "satiety_per_hour": 6.0
  }
 ],
 "fitness_combat_stats": {
  "apprentice": {
   "attack": 100,
   "defense": 30,
   "hp": 400,
   "speed": 50,
   "skills": [
    "基础拳击"
   ]
  },
  "skilled": {
   "attack": 120,
   "defense": 36,
   "hp": 480,
   "speed": 50,
   "skills": [
    "基础拳击",
    "踢击"
   ]
  },
  "proficient": {
   "attack": 144,
   "defense": 43,
   "hp": 576,
   "speed": 50,
   "skills": [
    "基础拳击",
    "踢击",
    "重拳"
   ]
  },
  "master": {
   "attack": 173,
   "defense": 52,
   "hp": 691,
   "speed": 50,
   "skills": [
    "基础拳击",
    "踢击",
    "重拳",
    "头槌"
   ]
  }
 },
 "job_postings": [
  {
   "id": "job:creative.singer",
   "name": "歌手",
   "description": "创作歌曲、街头卖唱；作品、粉丝与演出约定在我是歌手app。",
   "title": "歌手",
   "terms": {
    "engagement": "self_employed",
    "tier": "side",
    "window": {
     "kind": "flexible"
    },
    "compensation": {
     "kind": "audience_support"
    },
    "settlement": "business_event",
    "funding": "audience"
   },
   "level": "entry",
   "pay_text": "收入来自听众自愿打赏",
   "required_skills": []
  },
  {
   "id": "job:agriculture.farmer",
   "name": "农夫",
   "description": "在农业区领一座农场种地养殖。没有工资：两块田和鸡、猪、牛三个栏的产出都归自己，收入全靠卖出去，摆摊、卖给超市或餐厅都行。只有农夫有农场；辞职后农场收回，地里的庄稼和栏里的牲畜一并清掉。",
   "title": "农夫",
   "terms": {
    "engagement": "self_employed",
    "tier": "side",
    "window": {
     "kind": "flexible"
    },
    "compensation": {
     "kind": "sales_revenue"
    },
    "settlement": "business_event",
    "funding": "buyers"
   },
   "level": "entry",
   "pay_text": "没有工资，收入靠卖收成和肉蛋",
   "required_skills": []
  },
  {
   "id": "job:service.restaurant_courier",
   "name": "外卖骑手",
   "description": "外卖平台骑手，可自由接单。在任意地点通过「App抢单」接取订单。出餐后平台会通知你，去餐厅取餐并送到顾客下单地点门口。每送成一单当场结40元（含平台补贴）；顾客一次点了几份的，一趟一起送、按一单结。注意：出餐后60分钟没去取餐，单子会被平台代送，白忙一场；取餐后60分钟没送到直接算配送事故——平台赔付顾客，餐费从你账上扣，那份饭归你自己吃。",
   "title": "外卖骑手",
   "terms": {
    "engagement": "claimed_task",
    "tier": "side",
    "window": {
     "kind": "flexible"
    },
    "compensation": {
     "kind": "fixed_per_task",
     "task_amount": 40
    },
    "settlement": "engagement_completion",
    "funding": "system"
   },
   "level": "entry",
   "pay_text": null,
   "required_skills": []
  },
  {
   "id": "job:civil.renovator",
   "name": "装修工",
   "description": "承接城建局的商品房装修订单，前往订单对应的户里施工。",
   "title": "装修工",
   "terms": {
    "engagement": "claimed_task",
    "tier": "side",
    "window": {
     "kind": "flexible"
    },
    "compensation": {
     "kind": "order_hourly"
    },
    "settlement": "engagement_completion",
    "funding": "system"
   },
   "level": "entry",
   "pay_text": "按所接订单的时薪结算，每干满1小时现结，中途停工按实际工时折算",
   "required_skills": []
  },
  {
   "id": "job:media.reporter",
   "name": "城市日报记者",
   "description": "城市日报记者。每天0点报社派一个采写任务，随机一个报道主题；你要在当天写出一篇与这个主题有关的署名报道。报道必须有真实采访：当面找人提问，对方愿意答才算数，拒访不算。采访够了就开始写稿，先起标题，再一段一段写，最多三段，写完当场交稿。交稿就算完成，拿满额日薪400元；当天没交稿，这天一分钱没有。稿子第二天早上6点汇成一期城市日报发行。",
   "title": "城市日报记者",
   "terms": {
    "engagement": "daily_task",
    "tier": "primary",
    "window": {
     "kind": "flexible"
    },
    "compensation": {
     "kind": "performance_daily",
     "daily_amount": 400
    },
    "settlement": "engagement_completion",
    "funding": "system"
   },
   "level": "entry",
   "pay_text": null,
   "required_skills": []
  },
  {
   "id": "job:office.trader",
   "name": "交易员",
   "description": "公司提供50000元本金，在任职公司买卖股票或盯盘；股票App使用个人账户。每小时绩效+1，满额收工；高水位以上新利润按职级分成，保底与分成均按绩效折算。仓位=持仓市值/本金，每日最大仓位至少30%，连续3个工作日未达标，下次开工时开除；净值低于本金一半也开除。连续3个工作日绩效不到满额的30%会被解约。",
   "title": "交易员",
   "terms": {
    "engagement": "unit_work",
    "tier": "primary",
    "window": {
     "kind": "fixed",
     "segments": [
      {
       "start_hour": 8,
       "end_hour": 20,
       "end_day_offset": 0
      }
     ],
     "days": "weekdays"
    },
    "compensation": {
     "kind": "base_profit_share",
     "base_daily_amount": 350
    },
    "settlement": "window_close",
    "funding": "system"
   },
   "level": "entry",
   "pay_text": null,
   "required_skills": []
  },
  {
   "id": "job:office.programmer",
   "name": "程序员",
   "description": "初级程序员。可工作时段工作日8:00-20:00，在公司写对一道需求绩效+1，写错不算；绩效满额6拿满日薪400元，不满按绩效拿，绩效已满当天收工；前一天绩效满额次日发10%全勤奖。连续3个工作日绩效不到满额的30%会被解约。表现达标可逐级晋升、涨日薪。",
   "title": "初级程序员",
   "terms": {
    "engagement": "unit_work",
    "tier": "primary",
    "window": {
     "kind": "fixed",
     "segments": [
      {
       "start_hour": 8,
       "end_hour": 20,
       "end_day_offset": 0
      }
     ],
     "days": "weekdays"
    },
    "compensation": {
     "kind": "performance_daily",
     "daily_amount": 400
    },
    "settlement": "window_close",
    "funding": "system"
   },
   "level": "junior",
   "pay_text": null,
   "required_skills": []
  },
  {
   "id": "job:medical.doctor",
   "name": "门诊医生",
   "description": "医院门诊医生，连续上七天、休七天，每天一个8小时的可工作时段，白班/晚班/夜班轮换，接待挂号候诊的病人。任职要求：医术达到熟手。病人只说得出自己哪儿难受，得的是什么病要你问诊判断；医术越高，你能从同一个病人身上看出的东西越多。时段内判对一位病人（疾病链和严重程度都对）或整理完一轮病历各绩效+1，绩效满额6拿满每班工资，不满按绩效拿，绩效已满当天收工；没人候诊时整理病历照样攒绩效。连续3个工作日绩效不到满额的30%会被解约。",
   "title": "门诊医生",
   "terms": {
    "engagement": "unit_work",
    "tier": "primary",
    "window": {
     "kind": "roster",
     "roster_slot": null
    },
    "compensation": {
     "kind": "performance_daily",
     "daily_amount": 500
    },
    "settlement": "window_close",
    "funding": "system"
   },
   "level": "entry",
   "pay_text": null,
   "required_skills": [
    {
     "skill_type": "medical",
     "min_level": "skilled"
    }
   ]
  },
  {
   "id": "job:service.police",
   "name": "警察",
   "description": "警察，连续上七天、休七天，每天一个8小时的可工作时段，白班/晚班/夜班轮换。任职要求：体能达到熟练水平（熟手）。你的职责是按已报案件在城里找到案件指向的罪犯并当场抓捕；罪犯可能拒捕并与你交手，打不过就会让对方逃走。时段内抓到1人就拿满每班工资460元并当天收工，没抓到人这天没有工资，抓错人（对方没有在办案件）当天工资归零。连续3个工作日绩效不到满额的30%会被解约。",
   "title": "警察",
   "terms": {
    "engagement": "unit_work",
    "tier": "primary",
    "window": {
     "kind": "roster",
     "roster_slot": null
    },
    "compensation": {
     "kind": "performance_daily",
     "daily_amount": 460
    },
    "settlement": "window_close",
    "funding": "system"
   },
   "level": "entry",
   "pay_text": null,
   "required_skills": [
    {
     "skill_type": "fitness",
     "min_level": "skilled"
    }
   ]
  }
 ],
 "continuous_roster_rules": {
  "week_days": 7,
  "cycle_days": 14,
  "shift_order": [
   "day",
   "evening",
   "night"
  ],
  "slots": {
   "group_1_a": {
    "group_index": 0,
    "works_first_week": true
   },
   "group_1_b": {
    "group_index": 0,
    "works_first_week": false
   },
   "group_2_a": {
    "group_index": 1,
    "works_first_week": true
   },
   "group_2_b": {
    "group_index": 1,
    "works_first_week": false
   },
   "group_3_a": {
    "group_index": 2,
    "works_first_week": true
   },
   "group_3_b": {
    "group_index": 2,
    "works_first_week": false
   }
  },
  "shift_schedule": {
   "day": [
    {
     "start_hour": 6,
     "end_hour": 14,
     "end_day_offset": 0
    }
   ],
   "evening": [
    {
     "start_hour": 14,
     "end_hour": 22,
     "end_day_offset": 0
    }
   ],
   "night": [
    {
     "start_hour": 22,
     "end_hour": 6,
     "end_day_offset": 1
    }
   ]
  }
 },
 "phone_apps": [
  {
   "id": "jobs",
   "title": "招聘App",
   "hint": "找工作、辞职",
   "icon": "💼",
   "required_footprint": null
  },
  {
   "id": "bank",
   "title": "银行App",
   "hint": "贷款、还款、转账",
   "icon": "🏦",
   "required_footprint": null
  },
  {
   "id": "housing",
   "title": "找房App",
   "hint": "公租房入住、全款买商品房、搬进自己的房子、卖房、免费借住管理",
   "icon": "🏠",
   "required_footprint": null
  },
  {
   "id": "delivery",
   "title": "外卖App",
   "hint": "点外卖送到当前地点门口",
   "icon": "🍜",
   "required_footprint": null
  },
  {
   "id": "shopping",
   "title": "购物App",
   "hint": "订做家具、查看订单和配送",
   "icon": "🛒",
   "required_footprint": null
  },
  {
   "id": "stocks",
   "title": "股票App",
   "hint": "用自己的钱买卖股票",
   "icon": "📈",
   "required_footprint": null
  },
  {
   "id": "gacha",
   "title": "扭蛋App",
   "hint": "抽卡、兑换、查看实时卡册和集换攻略",
   "icon": "🎴",
   "required_footprint": null
  },
  {
   "id": "my_business",
   "title": "生意App",
   "hint": "自己当老板：开餐厅、健身房、服装工作室、造型沙龙、家具工坊、作坊或超市，看各店经营报告，招人管人、上下架菜品、加购机器、改收购策略、闭店退租都在这里",
   "icon": "🏪",
   "required_footprint": null
  },
  {
   "id": "singer",
   "title": "我是歌手app",
   "hint": "原创歌曲、粉丝与酒吧演出预约",
   "icon": "🎤",
   "required_footprint": "singer"
  },
  {
   "id": "martial",
   "title": "武道大会App",
   "hint": "全城武道大会：一周报名一周打，比赛周在商业街逐轮淘汰，冠军得奖金、金腰带和称号",
   "icon": "🥊",
   "required_footprint": null
  },
  {
   "id": "news",
   "title": "新闻App",
   "hint": "看看城里最近发生了什么",
   "icon": "📰",
   "required_footprint": null
  },
  {
   "id": "moments",
   "title": "朋友圈App",
   "hint": "分享生活，看看熟人和同城动态、赞评",
   "icon": "👥",
   "required_footprint": null
  }
 ],
 "hairstyles": [
  {
   "id": 1,
   "name": "蓬松短发",
   "description": "短发蓬松，额前有碎刘海",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 2,
   "name": "上扬短发",
   "description": "额前向一侧扬起，露出额头",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 3,
   "name": "偏分垂发",
   "description": "偏分刘海，一侧垂得较长",
   "group": "中长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 4,
   "name": "圆弧波波",
   "description": "圆弧发顶，两侧贴近脸颊",
   "group": "中长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 5,
   "name": "碎层短发",
   "description": "短发分层，侧边略微外翘",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 6,
   "name": "贴头短发",
   "description": "发量轮廓紧凑，额前轻微偏分",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 7,
   "name": "中分短波波",
   "description": "中间分开，两侧弧形包脸",
   "group": "中长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 8,
   "name": "蓬松横刘海",
   "description": "发顶宽而蓬松，刘海横向铺开",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 9,
   "name": "侧分长直发",
   "description": "顺直长发垂在一侧，额前偏分",
   "group": "长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 10,
   "name": "斜刘海短发",
   "description": "斜向刘海，侧边短而整齐",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 11,
   "name": "尖翘短发",
   "description": "顶部和侧边有明显上翘发束",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 12,
   "name": "平顶短发",
   "description": "发顶较平，前额一束向侧面伸出",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 13,
   "name": "凌乱碎发",
   "description": "刘海分成数缕，轮廓有些凌乱",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 14,
   "name": "整齐短发",
   "description": "贴头的短发，刘海平整",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 15,
   "name": "顺直披发",
   "description": "顺直发丝从头顶垂下，侧边较长",
   "group": "长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 16,
   "name": "轻薄短发",
   "description": "短而轻薄，额前自然分开",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 17,
   "name": "高蓬前额",
   "description": "前额一束明显抬高，侧边收短",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 18,
   "name": "偏分短波波",
   "description": "偏分刘海斜落，一侧包住脸颊",
   "group": "中长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 19,
   "name": "圆润短发",
   "description": "圆润发顶，细碎刘海落在额前",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 20,
   "name": "利落平刘海",
   "description": "短发轮廓利落，额前横向刘海",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 21,
   "name": "外翘碎层",
   "description": "两侧发束外翘，顶部轮廓有棱角",
   "group": "中长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 22,
   "name": "侧扫短发",
   "description": "刘海向一侧扫去，侧边有碎发",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 23,
   "name": "厚刘海短发",
   "description": "厚刘海铺在额前，侧边稍长",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 24,
   "name": "偏分碎层",
   "description": "偏分的短层次，侧边自然下垂",
   "group": "中长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 25,
   "name": "柔顺侧分",
   "description": "发顶平顺，偏分刘海与侧发连成一片",
   "group": "中长发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 26,
   "name": "蓬松侧扫",
   "description": "前额蓬起并向一侧梳去",
   "group": "短发",
   "colors": [
    {
     "id": 1,
     "name": "金棕"
    },
    {
     "id": 2,
     "name": "浅棕"
    },
    {
     "id": 3,
     "name": "栗棕"
    },
    {
     "id": 4,
     "name": "深棕"
    },
    {
     "id": 5,
     "name": "银灰"
    },
    {
     "id": 6,
     "name": "灰褐"
    },
    {
     "id": 7,
     "name": "蓝黑"
    }
   ]
  },
  {
   "id": 27,
   "name": "彩色长直发",
   "description": "明亮长直发，圆润发顶与长侧发",
   "group": "彩色发型",
   "colors": [
    {
     "id": 1,
     "name": "樱粉"
    },
    {
     "id": 2,
     "name": "草绿"
    },
    {
     "id": 3,
     "name": "浅蓝"
    },
    {
     "id": 4,
     "name": "宝蓝"
    },
    {
     "id": 5,
     "name": "亮黄"
    },
    {
     "id": 6,
     "name": "朱红"
    }
   ]
  },
  {
   "id": 28,
   "name": "彩色双髻",
   "description": "顶部两团小发髻，侧边留长发",
   "group": "彩色发型",
   "colors": [
    {
     "id": 1,
     "name": "樱粉"
    },
    {
     "id": 2,
     "name": "草绿"
    },
    {
     "id": 3,
     "name": "浅蓝"
    },
    {
     "id": 4,
     "name": "宝蓝"
    },
    {
     "id": 5,
     "name": "亮黄"
    },
    {
     "id": 6,
     "name": "朱红"
    }
   ]
  },
  {
   "id": 29,
   "name": "彩色尖束",
   "description": "两侧上扬的尖发束，额前斜落刘海",
   "group": "彩色发型",
   "colors": [
    {
     "id": 1,
     "name": "樱粉"
    },
    {
     "id": 2,
     "name": "草绿"
    },
    {
     "id": 3,
     "name": "浅蓝"
    },
    {
     "id": 4,
     "name": "宝蓝"
    },
    {
     "id": 5,
     "name": "亮黄"
    },
    {
     "id": 6,
     "name": "朱红"
    }
   ]
  }
 ],
 "phone_bank": {
  "loan_salary_multiplier": 5,
  "loan_min_credit": 200,
  "max_active_loans": 3
 },
 "phone_gacha": {
  "base_price_by_count": {
   "1": 20,
   "5": 100
  },
  "daily_draw_limit": 10,
  "daily_spend_limit": 200,
  "card_sets": [
   {
    "key": "cats",
    "name": "猫猫宇宙",
    "cards": [
     {
      "template_id": "tpl:card.cats.orange_cat",
      "key": "orange_cat",
      "name": "大橘猫",
      "rarity": "common",
      "description": "十只橘猫九只胖，还有一只特别胖。"
     },
     {
      "template_id": "tpl:card.cats.tabby",
      "key": "tabby",
      "name": "狸花猫",
      "rarity": "common",
      "description": "小区野战排第一名。"
     },
     {
      "template_id": "tpl:card.cats.tuxedo",
      "key": "tuxedo",
      "name": "奶牛猫",
      "rarity": "common",
      "description": "黑白花色，脑回路也同样跳脱。"
     },
     {
      "template_id": "tpl:card.cats.siamese",
      "key": "siamese",
      "name": "暹罗猫",
      "rarity": "common",
      "description": "像一块在炉边烤焦了边的奶糖。"
     },
     {
      "template_id": "tpl:card.cats.golden_shaded",
      "key": "golden_shaded",
      "name": "金渐层",
      "rarity": "common",
      "description": "圆眼睛里装着一整个罐头柜。"
     },
     {
      "template_id": "tpl:card.cats.ragdoll",
      "key": "ragdoll",
      "name": "布偶猫",
      "rarity": "rare",
      "description": "蓝眼睛的行走玩偶。"
     },
     {
      "template_id": "tpl:card.cats.maine_coon",
      "key": "maine_coon",
      "name": "缅因猫",
      "rarity": "rare",
      "description": "威风凛凛的大体格，心里还是小猫。"
     },
     {
      "template_id": "tpl:card.cats.devon_rex",
      "key": "devon_rex",
      "name": "德文卷毛猫",
      "rarity": "rare",
      "description": "大耳朵、小卷毛，像来自外星的精灵。"
     },
     {
      "template_id": "tpl:card.cats.black_cat",
      "key": "black_cat",
      "name": "月夜黑猫",
      "rarity": "epic",
      "description": "屋脊上掠过的一团无声夜色。"
     },
     {
      "template_id": "tpl:card.cats.caracal",
      "key": "caracal",
      "name": "狞猫大人",
      "rarity": "legendary",
      "description": "耳尖的黑色长穗是它的王冠。"
     }
    ]
   },
   {
    "key": "dogs",
    "name": "狗狗乐园",
    "cards": [
     {
      "template_id": "tpl:card.dogs.shiba",
      "key": "shiba",
      "name": "柴犬",
      "rarity": "common",
      "description": "脸上永远挂着不太服气的微笑。"
     },
     {
      "template_id": "tpl:card.dogs.corgi",
      "key": "corgi",
      "name": "小短腿柯基",
      "rarity": "common",
      "description": "屁股一扭一扭的行走面包。"
     },
     {
      "template_id": "tpl:card.dogs.golden_retriever",
      "key": "golden_retriever",
      "name": "金毛巡回犬",
      "rarity": "common",
      "description": "人类幼崽的免费保姆。"
     },
     {
      "template_id": "tpl:card.dogs.labrador",
      "key": "labrador",
      "name": "拉布拉多",
      "rarity": "common",
      "description": "看到水坑就无法控制四条腿。"
     },
     {
      "template_id": "tpl:card.dogs.pug",
      "key": "pug",
      "name": "巴哥犬",
      "rarity": "common",
      "description": "一脸认真地思考下一顿饭。"
     },
     {
      "template_id": "tpl:card.dogs.border_collie",
      "key": "border_collie",
      "name": "边境牧羊犬",
      "rarity": "rare",
      "description": "它不是听不懂，只是在判断你值不值得听。"
     },
     {
      "template_id": "tpl:card.dogs.husky",
      "key": "husky",
      "name": "拆家二哈",
      "rarity": "rare",
      "description": "沙发的天敌，快乐的源泉。"
     },
     {
      "template_id": "tpl:card.dogs.doberman",
      "key": "doberman",
      "name": "杜宾犬",
      "rarity": "rare",
      "description": "门口最挺拔也最可靠的黑色剪影。"
     },
     {
      "template_id": "tpl:card.dogs.samoyed",
      "key": "samoyed",
      "name": "微笑萨摩耶",
      "rarity": "epic",
      "description": "行走的云朵，天使的微笑。"
     },
     {
      "template_id": "tpl:card.dogs.alaskan_malamute",
      "key": "alaskan_malamute",
      "name": "雪原阿拉斯加",
      "rarity": "legendary",
      "description": "极光之下，雪原尽头的领路者。"
     }
    ]
   },
   {
    "key": "wardrobe",
    "name": "梦幻衣橱",
    "cards": [
     {
      "template_id": "tpl:card.wardrobe.strawberry_dress",
      "key": "strawberry_dress",
      "name": "草莓蓬蓬裙",
      "rarity": "common",
      "description": "把整个春天穿在身上的甜甜裙装。"
     },
     {
      "template_id": "tpl:card.wardrobe.sailor_uniform",
      "key": "sailor_uniform",
      "name": "海盐水手服",
      "rarity": "common",
      "description": "清爽得像刚吹过海面的风。"
     },
     {
      "template_id": "tpl:card.wardrobe.mint_tracksuit",
      "key": "mint_tracksuit",
      "name": "薄荷运动装",
      "rarity": "common",
      "description": "轻盈、利落，还带一点薄荷糖气息。"
     },
     {
      "template_id": "tpl:card.wardrobe.raincoat",
      "key": "raincoat",
      "name": "雨夜风衣",
      "rarity": "common",
      "description": "雨幕和霓虹都落在深蓝衣摆上。"
     },
     {
      "template_id": "tpl:card.wardrobe.plaid_outfit",
      "key": "plaid_outfit",
      "name": "复古格纹套装",
      "rarity": "common",
      "description": "适合带一本旧书去喝下午茶。"
     },
     {
      "template_id": "tpl:card.wardrobe.sakura_kimono",
      "key": "sakura_kimono",
      "name": "樱花和服",
      "rarity": "rare",
      "description": "衣袖展开时，像一场迟来的花雨。"
     },
     {
      "template_id": "tpl:card.wardrobe.red_qipao",
      "key": "red_qipao",
      "name": "赤金旗袍",
      "rarity": "rare",
      "description": "赤色缎面上游走着金色云纹。"
     },
     {
      "template_id": "tpl:card.wardrobe.forest_dress",
      "key": "forest_dress",
      "name": "森林精灵裙",
      "rarity": "rare",
      "description": "叶片、藤蔓与晨露织成的礼服。"
     },
     {
      "template_id": "tpl:card.wardrobe.moonlight_gown",
      "key": "moonlight_gown",
      "name": "月光礼服",
      "rarity": "epic",
      "description": "裙摆盛着一层安静的月光。"
     },
     {
      "template_id": "tpl:card.wardrobe.galaxy_gown",
      "key": "galaxy_gown",
      "name": "星河公主裙",
      "rarity": "legendary",
      "description": "旋转时，整条银河也跟着流动。"
     }
    ]
   },
   {
    "key": "birds",
    "name": "可爱小鸟",
    "cards": [
     {
      "template_id": "tpl:card.birds.sparrow",
      "key": "sparrow",
      "name": "小麻雀",
      "rarity": "common",
      "description": "在屋檐和米粒之间忙碌一整天。"
     },
     {
      "template_id": "tpl:card.birds.java_sparrow",
      "key": "java_sparrow",
      "name": "白文鸟",
      "rarity": "common",
      "description": "像一颗长出小脚的白糯米团。"
     },
     {
      "template_id": "tpl:card.birds.budgie",
      "key": "budgie",
      "name": "虎皮鹦鹉",
      "rarity": "common",
      "description": "对所有会响的小东西充满兴趣。"
     },
     {
      "template_id": "tpl:card.birds.cockatiel",
      "key": "cockatiel",
      "name": "玄凤鹦鹉",
      "rarity": "common",
      "description": "头顶的天线随心情升降。"
     },
     {
      "template_id": "tpl:card.birds.swallow",
      "key": "swallow",
      "name": "春燕",
      "rarity": "common",
      "description": "剪开春风的一道蓝黑弧线。"
     },
     {
      "template_id": "tpl:card.birds.long_tailed_tit",
      "key": "long_tailed_tit",
      "name": "银喉长尾山雀",
      "rarity": "rare",
      "description": "一颗白团子拖着一条长长尾巴。"
     },
     {
      "template_id": "tpl:card.birds.kingfisher",
      "key": "kingfisher",
      "name": "翠鸟",
      "rarity": "rare",
      "description": "从水面掠过的一颗蓝色宝石。"
     },
     {
      "template_id": "tpl:card.birds.hummingbird",
      "key": "hummingbird",
      "name": "蜂鸟",
      "rarity": "rare",
      "description": "悬停在花前的彩色小精灵。"
     },
     {
      "template_id": "tpl:card.birds.red_crowned_crane",
      "key": "red_crowned_crane",
      "name": "丹顶鹤",
      "rarity": "epic",
      "description": "晨雾里展开双翼的湿地舞者。"
     },
     {
      "template_id": "tpl:card.birds.bird_of_paradise",
      "key": "bird_of_paradise",
      "name": "极乐鸟",
      "rarity": "legendary",
      "description": "雨林深处最华丽的一场独舞。"
     }
    ]
   },
   {
    "key": "midnight_bites",
    "name": "深夜食堂",
    "cards": [
     {
      "template_id": "tpl:card.midnight_bites.skewers",
      "key": "skewers",
      "name": "路边烤串",
      "rarity": "common",
      "description": "深夜的第一声滋啦。"
     },
     {
      "template_id": "tpl:card.midnight_bites.oden",
      "key": "oden",
      "name": "关东煮",
      "rarity": "common",
      "description": "便利店暖柜里咕嘟咕嘟的温柔。"
     },
     {
      "template_id": "tpl:card.midnight_bites.jianbing",
      "key": "jianbing",
      "name": "煎饼果子",
      "rarity": "common",
      "description": "薄脆要双份才够意思。"
     },
     {
      "template_id": "tpl:card.midnight_bites.noodles",
      "key": "noodles",
      "name": "一碗阳春面",
      "rarity": "common",
      "description": "简单到极致的抚慰。"
     },
     {
      "template_id": "tpl:card.midnight_bites.baozi",
      "key": "baozi",
      "name": "灌汤包",
      "rarity": "common",
      "description": "小心烫，先开窗后喝汤。"
     },
     {
      "template_id": "tpl:card.midnight_bites.crayfish",
      "key": "crayfish",
      "name": "麻辣小龙虾",
      "rarity": "rare",
      "description": "剥壳的手停不下来。"
     },
     {
      "template_id": "tpl:card.midnight_bites.hotpot",
      "key": "hotpot",
      "name": "深夜火锅",
      "rarity": "rare",
      "description": "一个人也要涮到心满意足。"
     },
     {
      "template_id": "tpl:card.midnight_bites.braised_pork",
      "key": "braised_pork",
      "name": "红烧肉",
      "rarity": "rare",
      "description": "颤巍巍亮晶晶的一整块幸福。"
     },
     {
      "template_id": "tpl:card.midnight_bites.sashimi",
      "key": "sashimi",
      "name": "刺身拼盘",
      "rarity": "epic",
      "description": "深夜里的一点小奢侈。"
     },
     {
      "template_id": "tpl:card.midnight_bites.buddha_jump",
      "key": "buddha_jump",
      "name": "佛跳墙",
      "rarity": "legendary",
      "description": "传说中让佛都翻墙的味道。"
     }
    ]
   },
   {
    "key": "beasts",
    "name": "山海异兽",
    "cards": [
     {
      "template_id": "tpl:card.beasts.bifang",
      "key": "bifang",
      "name": "毕方",
      "rarity": "legendary",
      "description": "独脚青鸟，见则天下起火。"
     },
     {
      "template_id": "tpl:card.beasts.qilin",
      "key": "qilin",
      "name": "麒麟",
      "rarity": "legendary",
      "description": "仁兽踏雪无痕，现世必有祥瑞。"
     },
     {
      "template_id": "tpl:card.beasts.baize",
      "key": "baize",
      "name": "白泽",
      "rarity": "legendary",
      "description": "通晓万物之情的神兽。"
     },
     {
      "template_id": "tpl:card.beasts.zhuyan",
      "key": "zhuyan",
      "name": "朱厌",
      "rarity": "legendary",
      "description": "白首赤足，见则天下大兵。"
     },
     {
      "template_id": "tpl:card.beasts.luwu",
      "key": "luwu",
      "name": "陆吾",
      "rarity": "legendary",
      "description": "昆仑山神，虎身九尾人面。"
     },
     {
      "template_id": "tpl:card.beasts.jiuwei",
      "key": "jiuwei",
      "name": "九尾狐",
      "rarity": "legendary",
      "description": "青丘之国，其音如婴儿。"
     },
     {
      "template_id": "tpl:card.beasts.kunpeng",
      "key": "kunpeng",
      "name": "鲲鹏",
      "rarity": "legendary",
      "description": "北冥有鱼，其名为鲲。"
     },
     {
      "template_id": "tpl:card.beasts.zhulong",
      "key": "zhulong",
      "name": "烛龙",
      "rarity": "legendary",
      "description": "睁眼为昼，闭眼为夜。"
     }
    ]
   }
  ],
  "happy_hour": {
   "title": "扭蛋欢乐时光",
   "active_weekdays": [
    5,
    6
   ],
   "start_minute": 1080,
   "end_minute": 1200,
   "price_numerator": 1,
   "price_denominator": 2,
   "daily_quota_exempt": true
  }
 },
 "business_wage_support_text": "开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。",
 "gameplay_guides": [
  {
   "key": "singer",
   "title": "歌手手册",
   "content_md": "在招聘App应聘歌手。收入来自听众自愿打赏。入职后可选择「创作歌曲」「街头卖唱」，在「我是歌手app」查看作品、粉丝、关注的歌手与演出约定。\n\n歌单与菜单、酒单一样，最多上架10首。定稿时有空位就自动上架，满了只存入作品收藏；在我是歌手app上下架，下架仍保留作品。街头卖唱和酒吧演唱会只能选歌单上的歌。玩家可发来整理请求，同意后删除选中的作品并从歌单移除；正在唱的曲段不受影响。\n\n创作按五步完成，后一步承接前面的材料：\n- 题材与视角：从自己的经历挑一件具体的事，写清谁对谁唱、想说却难以说出口的是什么，以及情绪怎样转变。\n- 具体意象：选两三个可见、可闻或可触的细节，让物件或动作表现这件事的变化。\n- 核心句：把最想说的话写成一句便于换气、能反复唱的副歌核心句，让它与意象相连。\n- 主歌与副歌：写成8—16行歌词。主歌用动作推进情境，副歌围绕核心句展开，结尾让同一意象有新的含义。句子适合开口唱，押韵服从意思。\n- 试唱定稿：检查拗口、空泛或情绪跳跃的地方，修改草稿，提交歌名与完整定稿。\n每步耗时见行动空间；定稿后保存作品，放下草稿会丢掉未完成内容。歌曲品级在创作中固定，唱功越高越容易写出高品级作品。唱功靠街头卖唱的实际时间增长。\n\n街头卖唱地点是居住区街道、商业街、市区街道和办公区街道。每段唱一首自己的歌，听众可随时加入；听完改善心情，歌曲品级越高效果越强。同一人每段领取一次心情奖励和一次支持机会；重听保留尚未使用的支持机会。歌手结束时仍在听的人一起结束并获得完整奖励，听众主动提前离开则放弃本次奖励。打赏与成为粉丝分别选择，粉丝按人计数。\n\n唱功达到熟手且有成歌后，可在我是歌手app向其他居民经营的酒吧约演出。选定开演日后，演出时段按当天酒吧的营业时间安排。双方收起手机后答复协议；同意后预付场地费托管。演出结束、歌手取消、缺席或提前收工，场地费结给店主；场地方取消则退还歌手。听众免费入场。\n\n按约到场选择「上台开演」，每首结束后选择「唱下一首」或「提前收工」。关门时结束演唱会，迟到仍按原定关门时刻收工。演唱会占用舞台期间开放麦关闭；听众每首重新选择听歌，每个新曲段各有一次奖励与支持机会。当过歌手就保留我是歌手app；辞职后仍可管理歌单、作品和粉丝，唱功也保留。创作、卖唱和预约演出需要在职；未完成的演出按歌手取消结清。"
  },
  {
   "key": "gacha",
   "title": "卡牌扭蛋与集换",
   "content_md": "# 卡牌扭蛋与集换攻略\n\n- 手机扭蛋App 抽卡、看卡册、集齐后兑换。常规卡池5个套系各10张（普通 5、稀有 3、史诗 1、传说 1）；山海异兽8张不进卡池，主要靠兑换常规套系或与人交换获得。每种卡第一张用于收藏，多出的是可交换的重复卡。\n- 每抽普通 60%、稀有 30%、史诗 8%、传说 2%，不能指定套系，某张指定传说卡每抽只有 0.4%；五连没有折扣或保底。\n- 集齐后要回 App 主动兑换：消耗该套每种各1张，常规套换神秘称号、纪念奖励和山海异兽卡，终极套换神秘称号和神秘大奖。\n- 只差1～2张时找人交换更划算：可以和在场的人面对面交换，也可以去地摊上摆出来卖或买。参考价值普通2元、稀有8元、史诗25元、传说80元、山海异兽150元，双方恰好缺什么通常更重要。"
  },
  {
   "key": "fishing",
   "title": "海滩钓鱼",
   "content_md": "# 海滩钓鱼须知\n\n- 新建城市起初只有金沙海滩，此后每满50名居民就多开放一片。海滩都挨着森林公园，每处10个钓位。人在海滩选「开始钓鱼」进入钓鱼状态，每杆选择饵料后「甩一杆」，付费饵料当场购买，随时「收竿」离开。\n- 渔获分四档：普通（草鱼、虾，偶尔破靴子）、稀有（鲈鱼、梭子蟹、鱿鱼）、史诗（大黄鱼、龙虾、珍珠）、传说（蓝鳍金枪鱼、沉船古董怀表），档次越高越值钱。只有饵和钓鱼水平影响收获：饵越好、水平越高，上钩越快、越容易出好货；守多久、鱼多大纯看运气。好饵平均能赚回本钱还有富余。\n- 钓上来的鱼当场收拾干净切成份，几公斤就切几份，按份进背包。渔获可以拿到正在收购的超市出售，也可以摆摊，也可以下厨、送人或当面交易。碰上「钓鱼时间」活动出好货概率翻倍，留意全城公告。\n- 海滩上还能「晒盐」：一小时一批，不占钓位；盐能下厨，也能卖给超市。\n- 每两周周日 09:00-12:00 全城钓鱼大赛，人人自动参赛，赛期内每杆渔获按价值记积分，13:30 公布排名，前三名有奖金，冠军得奖杯。"
  },
  {
   "key": "pets",
   "title": "驯服野猫",
   "content_md": "# 驯服野猫\n\n- 在发现地点选择“耐心陪伴”或“投喂并陪伴”提升信任。投喂每次消耗1份食物，营养越高增长越快，100营养达到2倍上限。\n- 猫愿意住进家里时可“接养并起名”，获得猫名牌。名牌可赠送、交易或摆摊出售。\n- 接养需要自己的卧室，最多3只，寄售中的猫也占名额。"
  },
  {
   "key": "farm",
   "title": "私人农场种田",
   "content_md": "# 私人农场种田手册\n\n- 农夫才有农场：一座农场两块田，鸡舍、猪栏、牛栏三个栏都已建好。到自己的农场就能直接选择农活或畜栏活计。一块田的周期：翻地 → 播种 → 日常照料 → 成熟后收割，收割后可以马上开始下一茬。\n- 作物需要水分和养分，还要防杂草和虫害；连着两三天不管会缺水、长慢、生虫，严重时枯死，死苗只能铲掉重来；成熟后放过头产量会打折。种田水平越高，看田越准。田里有明显虫害时可以除虫，只花工时。\n- 七种食用作物：青菜、土豆、葱便宜好养见效快；番茄、辣椒卖得贵但娇气（番茄要水多，辣椒怕虫）；蒜和洋葱最慢但产量最高。认真经营两块田，每天花大约3小时照料，收成可以自己吃或卖掉。\n- 四种原料作物：水稻、小麦、大豆、甘蔗，收下来的稻谷、小麦、大豆、甘蔗是加工原料，可以卖给超市、卖给人，或拿去作坊加工成大米、面粉、油、豆腐、酱油、糖，也能酿成酒吧调酒用的基酒。棉花、蓝染果同理，是做衣服的料。\n- 收成进背包，拿到正在收购的超市出售（收购品种、价格和店家的资金以现场为准），或摆摊卖给有需要的人，也可以下厨、送人或当面交易。\n\n- 鸡舍、猪栏、牛栏固定分开，分别能养8只鸡、4头猪、2头牛。「买苗入栏」按只购买，也能补苗；每只分别成长。食槽接收未加工的农作物：蔬菜、稻谷、小麦、大豆、甘蔗；按参考价折算口粮，贵的少投、便宜的多投，喂满成本接近；可以混着补，取整和当天吃不完的余料保留，每天按实际头数吃，连续没吃饱会饿死。鸡下的蛋留在鸡舍，定期「捡蛋」收进背包；「屠宰」每次处理一只日龄最大的动物，未成熟的出肉较少。牛只产牛肉，不产奶。肉蛋可以做饭、送人、卖超市或挂市集。\n\n- 在自己的农场可「采集木材」，按已完成劳动逐步获得木材，用于制作家具或出售。"
  },
  {
   "key": "martial_tournament",
   "title": "武道大会参赛",
   "content_md": "# 武道大会参赛手册\n\n- 每两周一届，报名周在手机武道大会App 报名（报名费100元），随后一周在商业街打单败淘汰赛；报名不足4人流局退费。\n- 你的每场比赛开打前1小时会收到通知，写明时刻和对手；赶到商业街在擂台边「报到候场」。开打时刻没到场、正在生病或体力不足 30 都会被判弃权。胜负由双方身手当场决出，体能熟练度越高攻防越强；一场约10分钟，非常耗体力。输一场即淘汰。\n- 冠军5000元奖金和金腰带，亚军2000元，四强各800元，八强各300元；前四名获得在位称号，生效到下一届比完。想涨本事就练体能，健身房最快，跟教练上私教课最快。"
  },
  {
   "key": "marketplace",
   "title": "集市摆摊",
   "content_md": "# 集市摆摊攻略\n\n- 买卖通用物品要到能摆摊的室外场景：居住区街道、办公区和市区的街道、商业街、各片海滩和小区院子。想卖东西就到那里的空地上摆一个摊：起个摊位名（同一场景不能重名），再把背包里的东西摆上去。摊位无人值守，买家自助购买；一人只能有一个摊，每处摊位有限、摆满了就得换个地方；一摊最多摆 10 样、每种最多100份，摆满三天没卖掉的退回背包，货全走完摊位自动释放。\n- 每样东西有一个城里行情价，浮动价品种每天零点按供需走一步：市场上货不够一天卖的「紧俏」，每天加价一成；超过三天卖不完的「积压」，每天打折一成；中间「正常」，价格往基准回。全摊共用一个定价策略：便宜点（行情九折）、按行情、贵一点（行情加一成），不逐件定价。成交价 = 成交那一刻的品种行情价 × 策略倍率，卖家扣 5% 手续费。初始按行情定价。上架和管理页提供行情、超市库存和本场景及别处其他摊位的最低价。\n- 买东西要走到摊前：先看本场景有哪些摊（便宜的排前面），再进某个摊看货，选定数量立即成交。衣物和食物逐件展示，可按属性和档位挑；其他品种同一摊上同价、先摆的先卖。补货、改定价策略在摊位所在场景的「我的摊位」里直接操作；人离场后摊位照常销售。「撤摊取回全部货物」取回未售货物并释放摊位，可在任何地点执行。角色超市只买卖固定品种的食材和原料，价格按行情和店家策略计算。\n\n食物不随供需涨跌：做好的菜按配方现算，售价与食材当天行情、菜的档位和这份的品质挂钩；食材行情一变，菜价跟着变。\n\n城市超市若为无限供应模式，食材和原料的行情固定在基准价，城市超市不会缺货。"
  },
  {
   "key": "restaurant_owner",
   "title": "餐厅经营",
   "content_md": "# 餐厅经营手册\n\n## 开店与清算\n\n- 打开手机生意App开餐厅，新店前30天免租。\n- 连续14个完整经营日亏损会被强制闭店，30个游戏日内不能再开餐厅。\n\n## 菜单\n\n- 餐厅只卖你自己研发的菜，别人的菜和家常菜谱都进不了菜单；开店时自动挂上你最近研发的菜，之后研发成功的新菜也会自动上架。菜单有道数上限，满了想上新菜要先下架一道。\n- 菜价按当前食材行情和菜品档位自动算，随食材行情涨跌；已下订单按下单价结算。你只决定哪些菜上架或下架。\n- 缺原料的菜自动沽清，补到原料自动恢复可售，不用下架；只有不想再卖才下架。\n\n## 备货\n\n- 没有原料做不出菜；去超市买食材，回店放进店内库存。\n- 做菜用掉库存里的食材时，按当时的超市价计入当天的食材成本。\n\n## 营业与后厨\n\n- 角色餐厅每天 9:00-23:00 接单。23:00 后不再接新单，24:00 闭店。\n- 营业时后厨必须有人（你自己掌勺，或在班厨师）才能接单和出餐，否则餐厅歇业，一单也卖不出去。\n- 你在店里没单的时候可以「守店」：在后厨备菜清灶等客，来单会马上停下去接。也可以趁空在店里的灶台研发新菜，店内库存的食材可以直接用。\n- 厨师分工作日和周末两类，每类三个班次：早班 9:00-14:00、中班 14:00-19:00、晚班 19:00-24:00。你只选发哪个班次、给多少时薪（60-200元/小时）；每个班次只能有一个厨师。\n- 厨师班次内在店的每一分钟按时薪计酬，班次结束时自动结算。开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。在岗小时看经营页。连续3个班次都没有在店时间会自动解约。\n- 调整招聘时薪只影响尚未招到人的岗位；改在职员工的时薪或班次要提出新条件，员工同意后次日生效，可拒绝。撤销招聘不影响在职员工。\n\n## 员工与兜底\n\n- 厨师缺岗时由你自己掌勺，餐厅才能继续营业；经常缺岗就换人或解雇。"
  },
  {
   "key": "dish_research",
   "title": "研发原创菜",
   "content_md": "# 研发原创菜\n\n- 任何有住处的角色都能在自家灶台选「研发新菜」，在家只消耗自己的背包食材；只有店主能在自家店研发，优先消耗店库存，不足才用自己的背包补。整锅试下来要占灶台一两个小时。\n- 研发可能失败（下过锅的食材全打水漂），也可能定型为只属于你的招牌菜，成功后才起名、写卖相描述。成功的菜有稀有档位：普通、精品、珍馐、传说，档位越高定价越高；只有传说菜问世时向在场角色公告。精品及以上自带食用特效（精品1种、珍馐2种、传说3种，定型后不变），出餐品质越高特效越强，餐厅现做比家常复刻更强。\n- 出好菜的规律：至少一种主料配上合适的调味与配菜；做法要配食材（清蒸配海鲜、慢炖配肉类）；主料先下、调味靠后；火候跟着做法走（慢炖大火起锅转小火，爆炒全程大火）。高档渔获显著提高出高档菜的机会；好料和好手艺都有助于做出传世之作，用料越贵越有机会；烹饪熟练度越高成功率越高。研发失败的评语会提示问题出在搭配还是火候。\n- 原创菜谱永远属于研发者，能在自家灶台用背包食材复刻；店主研发成功时菜单未满会自动上架，满了先收进「我的原创菜谱」。"
  },
  {
   "key": "restaurant_staff",
   "title": "餐厅打工",
   "content_md": "# 餐厅打工须知\n\n- 你的合同是一个固定班次（工作日或周末的早班 9:00-14:00、中班 14:00-19:00、晚班 19:00-24:00）加一个时薪。班次内人在店里的每一分钟都按时薪算钱，干什么都算；班次结束时自动结算。班次外在店不算工钱。\n- 开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。老板付不出会记欠薪，欠薪次日合同自动解除，欠的钱转成老板对你的债务。\n- 连续3个班次都没有在店时间，合同自动解除，30天内不能重新应聘。\n- 饿了可以直接用后厨给自己做饭，用店里食材按双倍成本价付给老板。"
  },
  {
   "key": "city_restaurant_staff",
   "title": "城市食堂打工",
   "content_md": "# 城市食堂员工须知\n\n- 店里供应标准菜谱和食材。有单时接单做菜，空闲时备菜清灶。\n- 班次内按实际在店时长和合同时薪计酬，由城里全额支付，班次结束结算。\n- 无人掌勺或订单久候时，后厨按基础水平出餐。\n- 连续3个班次都没有在店时间，合同自动解除，30天后可重新应聘。\n- 食堂停业时结清已干工时，再解除合同，可另找工作。"
  },
  {
   "key": "city_bar_staff",
   "title": "城市酒馆打工",
   "content_md": "在班时去城市酒馆，接单调酒，空闲时擦杯。基酒和辅料由店里供应；酒单固定。\n\n工资由城里全额支付，按班次内实际在店时长折算，班次结束结清。连续缺勤会解约；店铺停业会结清已干的工时，再解除合同。"
  },
  {
   "key": "city_barbershop_staff",
   "title": "城市造型沙龙打工",
   "content_md": "在班时去城市造型沙龙，接待队首顾客。顾客选择部位并说要求，你从目录设计头发、肤色、眼睛或饰品；只改选中部位，按实际变化计费与占时，方案至少改变一处。完成后一起更新外观、收钱。空闲时打扫；没有居民造型师能接待时，常驻造型师接手。"
  },
  {
   "key": "bar_owner",
   "title": "酒吧经营",
   "content_md": "# 酒吧经营手册\n\n## 开店与清算\n\n- 打开手机生意App开酒吧，新店前30天免租。\n- 连续14个完整经营日亏损会被强制关店，30个游戏日内不能再开酒吧。\n\n## 基酒与库房\n\n- 库房只放基酒：麦芽酒、米酒、甘蔗酒。作坊能把小麦、稻谷、甘蔗酿成基酒，超市也收卖基酒。\n- 基酒在背包里不能直接喝；营业调酒使用库房里的基酒，人在店里可以把背包的基酒入库。研发先用库房，不足再从背包补。\n- 调一杯用掉的基酒，按当时的超市价计入当天成本。\n\n## 研发新酒\n\n- 只能在自家吧台研发，一次定完：几份基酒（1-2份）、加哪几样辅料（最多2样，可以不加）、调法和冰量；原料一共2-4种。\n- 辅料在吧台辅料柜里，用一份当场从你现金里按柜价扣——平价：可乐5元、酸奶6元、果汁8元、奶茶12元、咖啡15元；中档：蜂蜜20元、薄荷叶25元、椰浆30元、桂花40元；高档：人参60元、燕窝80元、藏红花90元、金箔100元。\n- 成色上限看用到的最高一档辅料：不加或只用平价最高精品，用到中档最高佳酿，用到高档且至少3种原料才可能出传说。调酒越熟练越不容易调砸，原料种类越多越容易调砸。调法和冰量只关乎这杯酒的样子。\n- 每次研发都由你喝掉试饮那一杯，成功或调砸都会增加醉意。调成了给它起个全城唯一的名字；调砸了只获得经验，基酒和辅料都用掉。成色越高，这款酒带的效果越多。\n\n## 酒单与定价\n\n- 酒单只卖你自己研发的酒，最多10款；研发成功的新酒自动上酒单，满了要先下架一款。\n- 售价按基酒行情成本与全部辅料柜价之和乘餐厅同档成色倍率，向上取整且至少20元；你只决定上架哪些。\n- 周六、周日营业时段堂饮酒水五折，差价由城市补给你；外卖酒水原价、免配送费。店里均按完整原价收款。\n- 库房基酒不够的酒自动售罄，补了基酒自动恢复。\n- 酒单上不写酒的效果：客人只知道自己喝出过什么；你看得到自家酒带的全部效果。\n\n## 营业与吧台\n\n- 酒吧18:00-24:00营业，23:00后不再点单。\n- 营业时吧台要有人（你自己，或在班调酒师）才能接单调酒，否则酒吧歇业。\n- 每杯现调：堂饮客人坐着等，外卖由骑手或平台送到下单地点门口，客人取进背包后再喝。出酒时调得越好点亮的效果越多，这杯的辅料也在这时从你现金里扣。\n- 调酒师分工作日晚班和周末晚班，都是18:00-24:00；你只选班次和时薪（60-200元/小时），每个班次一个人。班次内在店的每一分钟按时薪计酬，班次结束自动结算。开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。工资计入当天成本。连续3个班次都没有在店时间会自动解约。"
  },
  {
   "key": "bar_staff",
   "title": "酒吧打工",
   "content_md": "# 酒吧打工须知\n\n- 你的合同是一个固定班次（工作日晚班或周末晚班，都是18:00-24:00）加一个时薪。班次内人在店里的每一分钟都按时薪算钱，干什么都算；班次结束时自动结算。班次外在店不算工钱。\n- 开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。老板付不出会记欠薪，欠薪次日合同自动解除，欠的钱转成老板对你的债务。\n- 连续3个班次都没有在店时间，合同自动解除，30天内不能重新应聘。\n- 有单就接单调酒，没单就擦杯备料；调酒越熟练，调得越快，出酒品质越好，酒里点亮的效果也越多。"
  },
  {
   "key": "barbershop_staff",
   "title": "造型沙龙打工",
   "content_md": "# 造型沙龙打工须知\n\n- 你的合同是一个固定班次（工作日或周末的白班 10:00-16:00、晚班 16:00-22:00）加一个时薪。班次内人在店里的每一分钟都按时薪算钱，干什么都算；班次结束时自动结算。班次外在店不算工钱。\n有顾客时接待队首：听取顾客选择的部位和要求，从目录提交最终造型。只调整顾客选中的部位，实际改变的部位分别计费、占时；至少改变一处。完成后统一换外观和收款，收入归店铺。空闲时打扫，来客排队时停下。\n- 开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。店主付不出会记欠薪，欠薪次日合同自动解除，欠的钱转成店主对你的债务。\n- 连续3个班次都没有在店时间，合同自动解除，30天内不能重新应聘。"
  },
  {
   "key": "gym_owner",
   "title": "健身房经营",
   "content_md": "# 健身房经营手册\n\n- 在手机生意App开馆、发布或撤销教练岗位、解雇教练、看经营数据、关店退租；站在自己馆里也能管理教练。\n- 场馆按天收租，从你的现金扣；付不起当天租金立即强制闭馆清算。连续14个完整经营日亏损自动闭馆清算，30个游戏日内不能再开。\n- 门票和月卡由入口刷卡机自助售卖，不需要有人在场；私教课必须教练在馆里才上得了，没有教练的馆只能卖门票和月卡。门票、月卡、课包的价格是固定的。\n- 教练是提成制：卖出月卡或课包你付销售提成，上完一节课你付课时费，都从你的现金即时扣；付不出记成你欠教练的钱，欠薪次日教练自动离职。教练离职时，你按剩余节数退课款，同时收回对应的课包提成。\n- 你自己也算本馆的一名教练：体能达到教练岗位的要求，就能像教练一样当面推销月卡和课包、给买了你课包的学员在馆里上课。卖课的钱直接归你。"
  },
  {
   "key": "gym_coach",
   "title": "健身教练工作",
   "content_md": "# 健身教练须知\n\n- 提成：卖出一张月卡或一个课包，老板付你售价30%的提成；每上完一节私教课，老板付你该档课价50%的课时费，由老板的现金即时支付；老板付不出记成他欠你的钱，欠着不结你次日自动离职。\n- 离职时，把未上课时对应的课包提成退给店主。\n- 收入来自两件事：在馆里或附近当面向人推销月卡和课包（谁能推、一天推几次，行动空间里会写明），以及给买了你课包的学员上课——学员和你都在馆里时，你可以找他开课，他也可以来找你。\n- 你不在馆里就没人能上课；课包卖出去了要常回馆里，卖出去的课才变成课时费。\n- 课包价格按你的体能等级分档，等级越高你赚得越多；体能掉回学徒就不能卖课上课。"
  },
  {
   "key": "tailor_studio_owner",
   "title": "服装工作室经营",
   "content_md": "# 服装工作室经营手册\n\n- 在手机生意App开服装工作室、加购和升级缝纫机、看经营数据、关店退租；站在自己店里也能做这些。\n- 开店费1000元一次付清，自带2台初级缝纫机；铺面按天收租，从你的现金扣，付不起当天租金立即强制闭店清算。连续14个完整经营日亏损自动闭店清算，30个游戏日内不能再开。\n- 店里不需要人守着：来做衣服的人自带棉花和蓝染果，开工时按所用缝纫机的等级付工费，直接归你（做一件衣服用15份棉花+8份蓝染果，按用的缝纫机等级付工费（每件初级10、中级20、高级40、顶级100元），机器越高档做得越快、高档成衣越容易出）；你自己在店里做免费。工费是固定的。\n- 缝纫机是你的资产：加购初级机1000元一台，一店最多6台；升级初级→中级 2000、中级→高级 4000、高级→顶级 10000。等级越高做得越快、每件收费越高、高档衣服越容易出；升到顶级那一刻随机定一条招牌属性，这台机器做的衣服更容易带它。正在用的机器不能升级。\n- 任何原因闭店，店里的设备都按累计投入的一半折价退回；设备投入不算经营亏损。"
  },
  {
   "key": "barbershop_owner",
   "title": "造型沙龙经营",
   "content_md": "# 造型沙龙经营\n\n最多两位顾客候位，你和在岗造型师可以同时各接待一位。顾客选择想调整的部位并说要求；造型师从目录设计头发、肤色、眼睛和饰品，未选部位保持原样。头发的款式与发色合算一处，饰品的款式与配色合算一处，也可去掉饰品。每处实际变化40元、20游戏分钟，原样部位免费且不占时，方案至少改变一处。饰品直接替换外观。全部完成后统一收钱、换造型；中断或结算余额不足，整单取消。收入归店铺。\n\n完成一位后回到日常行动，你可以接下一位，也可去做其他事。顾客能看到至少还需多久，也可以等到自己选择的时限后离开。店里没有能造型的人时队列散去。\n\n## 雇造型师\n\n- 造型师分工作日和周末两类，每类两个班次：白班 10:00-16:00、晚班 16:00-22:00。你只选发哪个班次、给多少时薪（60-200元/小时）；每个班次只能有一个造型师。\n- 造型师班次内在店的每一分钟按时薪计酬，班次结束时自动结算。开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。工资计入当天成本。连续3个班次都没有在店时间会自动解约。\n- 调整招聘时薪只影响尚未招到人的岗位；改在职造型师的时薪或班次要提出新条件，对方同意后次日生效，可拒绝。撤销招聘不影响在职造型师。\n\n付不起日租就清算；连续14个完整经营日亏损也会清算，30日内不能再开。闭店不退款，在职造型师随之解约。"
  },
  {
   "key": "tailoring",
   "title": "做衣服",
   "content_md": "# 做衣服\n\n- 城里的衣服有两条来路：服装店的白板衣（款式少、更贵、穿几天就坏、没有属性），以及角色自己做的衣服（更耐穿、每件带一条实用属性，穿在身上才生效）。\n- **原料**：私有农田能种棉花和蓝染果。这两样能卖给超市，超市有货时也能买到；想做衣服就自己种、去超市或地摊上买，或找种地的人买。\n- **在哪做**：带着原料到服装工作室，挑一台空闲的缝纫机，开工时按机器等级向店里付工费（做一件衣服用15份棉花+8份蓝染果，按用的缝纫机等级付工费（每件初级10、中级20、高级40、顶级100元），机器越高档做得越快、高档成衣越容易出）；店主在自己店里免费。顶级机还有一条招牌属性，做出来的衣服更容易带它。\n- **做一件衣服**：款式、颜色和属性都是做出来那一刻才揭晓，跟拆盲盒一样；裁缝手艺越高、机器越好、身上带着「巧手」buff（吃的或穿的），开出高档属性的机会越大。做多了手艺会涨。\n- **越好的衣服越耐穿**：白板衣穿几天就坏，裁缝衣成色越高越耐穿，最好的能穿一个月。\n- **做出来怎么办**：自己穿、送人，或摆摊卖给别人（只收全新的）；价格由城里行情按档位定，只选定价策略，卖不卖得动看行情标签。商店不回收裁缝衣，普通白板衣可以回收。"
  },
  {
   "key": "workshop_owner",
   "title": "作坊经营",
   "content_md": "# 作坊经营手册\n\n- 在手机生意App开作坊、加购加工机、看经营数据、关店退租；站在自己店里也能做这些。\n- 开店费1000元一次付清，自带2台加工机；铺面按天收租，从你的现金扣，付不起当天租金立即强制闭店清算。连续14个完整经营日亏损自动闭店清算，30个游戏日内不能再开。\n- 店里不需要人守着：来加工的人自带稻谷、小麦、大豆、甘蔗，挑一台空闲加工机、选一种加工，开工时按批付工费，直接归你；你自己在店里加工免费。工费固定：碾米1份稻谷→1份大米、磨面1份小麦→1份面粉、点豆腐1份大豆→1份豆腐、榨油2份大豆→1份食用油、酿酱油2份大豆+1份盐→2份酱油、熬糖2份甘蔗→1份糖、酿麦芽酒2份小麦→1份麦芽酒、酿米酒2份稻谷→1份米酒、酿甘蔗酒4份甘蔗→1份甘蔗酒；一批最多50份主原料、不足也能开工，占机30分钟，每批工费20元。\n- 加工机是你的资产：加购1000元一台，一店最多6台，多一台就能多接一个人同时加工。\n- 任何原因闭店，店里的设备都按累计投入的一半折价退回；设备投入不算经营亏损。"
  },
  {
   "key": "milling",
   "title": "作坊加工",
   "content_md": "# 作坊加工\n\n- 大米、面粉、豆腐、油、酱油、糖除了超市买，也能自己做：把地里收的原料拿到作坊加工。\n- 作坊还能酿基酒：小麦酿麦芽酒、稻谷酿米酒、甘蔗酿甘蔗酒。基酒是酒吧调酒的原料，背包里不能直接喝。\n- **原料**：私有农田能种水稻、小麦、大豆、甘蔗，收下来的稻谷、小麦、大豆、甘蔗能卖给超市，超市有货时也能买到；酿酱油还要盐，盐在海滩晒。\n- **在哪做**：带着原料到作坊，挑一台空闲加工机、选一种加工，开工时按批向店里付工费；店主在自己店里免费。\n- **一批怎么算**：碾米1份稻谷→1份大米、磨面1份小麦→1份面粉、点豆腐1份大豆→1份豆腐、榨油2份大豆→1份食用油、酿酱油2份大豆+1份盐→2份酱油、熬糖2份甘蔗→1份糖、酿麦芽酒2份小麦→1份麦芽酒、酿米酒2份稻谷→1份米酒、酿甘蔗酒4份甘蔗→1份甘蔗酒；一批最多50份主原料、不足也能开工，占机30分钟，每批工费20元。开工时按背包里的原料自动装满一批，不足一批也能开工；原料开工就扣掉，中途被打断不退。\n- **成品**：完成时直接进背包。粮油是普通食材，自己做饭、卖给超市或摆摊卖都行；基酒可以卖给超市、摆摊，或卖给开酒吧的人。"
  },
  {
   "key": "furniture",
   "title": "家具制作与安家",
   "content_md": "# 家具制作与安家\n\n- 植物、地毯、柜子、桌几、灯具、挂画、装饰单椅和鱼缸由自己安装后增加住处温馨值。自己的卧室与户内客厅的温馨值合计，每10点使在家休息、睡觉时的体力和心情恢复加快1%，上限50%。\n- 到家具工坊自助制作，原料可自备、店供或自备优先由店里补足；通过购物App订做则全部店供，由店主或当班家具设计师制作。木材由农夫在自己的农场采集，棉花来自农田，两者均可交易购买。\n- 店供材料按行情价的120%计价。按配方工时，自助每小时付10元工位费，委托每小时付75元手工费；店主给自己下单也同价。下单即确认订购，预留原料与款项，完工结算给工坊，成品归顾客。\n- 自助制作被打断后可继续剩余工时；委托被强制打断后回到单池，重新接单从头制作，沿用预留的原料和款项。\n- 自助可选自提或配送；手机订做配送到下单时的住处，搬家后仍送该地址。每单运费40元由顾客付，骑手送达后领取。无人取货超时由平台代送；取货后配送超时扣骑手100元，以现有现金为限，平台代送并收取运费。认领前可到保管地点自提，退回运费。送达后在订单地址领取，再到房间安装。\n- 公租租户和商品房借住者可在自己的卧室安装装饰家具；商品房业主还可在客厅安装。每房间最多24件，同款可安装多件。落地家具需要空位，地毯可铺在家具下；挂画需要可用墙面，台灯和鱼缸需要同房间装饰桌柜的空台面。\n- 在家具所在房间可收回自己安装的家具，空出位置后再安装新件。搬离时自己的家具随本人收回；承托桌柜搬走时，上面的装饰也退回各自主人。工坊关闭时，未完工订单退预付款和自备原料；店内已完工待取的家具移到商业街保管。\n\n- 下单满24小时仍未完工，订单自动关闭，全额退回预付款（含运费），自备原料退回顾客、店供原料退回工坊。"
  },
  {
   "key": "furniture_workshop_owner",
   "title": "家具工坊经营",
   "content_md": "# 家具工坊经营手册\n\n- 在生意App开家具工坊、加购家具工位、招聘和管理员工、查看经营数据、关店退租。\n- 开店费1000元，附2个工位；加购每个1000元，上限6个。每个工位同时供一人制作，自助顾客、店主和家具设计师共用。\n- 到自家工坊选择原料和数量存入或取回。库存只计可用原料，订单已预留的材料归订单保管。\n- 店主或当班家具设计师在店时可承接委托。设计师按约定班次和时薪工作，没单时可整理家具工位。顾客支付的材料费和工费在完工后进入店主现金；设计师工资另行结算。开店前30个游戏日，店员工资由城市承担60%、店主承担40%。期满后，城市继续承担30%，店主承担70%。\n- 前30个游戏日免租，之后按名下门店顺序计日租，金额见生意App。现金付不起当天租金，或连续14个完整经营日亏损，会闭店清算。经营成本包括原料和工资，设备投入单独核算。\n- 关店时设备按累计投入的50%折价退回，可用库存回店主背包；顾客订单按家具攻略结清。关店后等30个游戏日可再开同类店。"
  },
  {
   "key": "grocery_owner",
   "title": "超市经营",
   "content_md": "# 超市经营手册\n\n- 在手机生意App开超市、改卖价策略、改收购策略、开始收购、停止收购、关店退租；站在自己店里也能做这些。上架、下架要人在店里，走货架交互的「上架 / 下架」；自己店里的货不用买，直接下架。\n- 你是中间商：别的角色把食材和原料作物卖给你的店，钱从你的现金付；货摆上货架，来买的人按行情价乘你的卖价策略付钱，直接归你。\n- 价格按城里行情定，你不报数：卖价三档（便宜点 / 按行情 / 贵一点），收购三档（行情七折 / 八折 / 九折）；收购价越高越容易收到货，利也越薄。开店费1000元、手里至少要有5000元才能开；收购价三档：行情七折 / 行情八折 / 行情九折；收购的钱从你的现金里扣，扣到只剩1000元就不再收，收多少、摆多少没有上限。\n- 收不收按每种货选：不想压哪样货就把它停收；收多少、摆多少没有上限。货架上有什么就卖什么，卖货不用你管。\n- 账按现金算：卖出算收入，收购货款与日租算支出。压一堆卖不掉的货就是亏；连续14个完整经营日亏损自动闭店清算，30个游戏日内不能再开；付不起当天日租立即清算。闭店不退开店费，货架上的货退回你的背包。"
  },
  {
   "key": "police",
   "title": "警察出勤",
   "content_md": "## 你的职责\n\n城里长期有人在作案，你的工作是主动找到他并抓住。\n\n## 案件从哪来\n\n有人报案后案件进入通缉，可工作时段内出现在当前上下文里；诈骗案的案发地是骗子来电时所在的区域。同一个人的案子并成一条，受害人越多、金额越大的越该优先抓。\n\n有人喝出酒疯当众动手，会以「闹事」列在案件里：谁、在哪、几点打了谁，24小时内有效。闹事的是城里的普通居民，不会潜伏，但人走了要自己去找。\n\n## 怎么找人\n\n唯一线索是**最近案发地**：从它入手，在周边人多的地方来回巡查。小偷和抢劫犯作案后、罪犯挣脱抓捕后会**潜伏**一阵、全城找不到，过一阵在案发地附近重新露面；骗子打完诈骗电话后继续在城里游荡。案件还挂着就说明他还没走。\n\n## 抓人\n\n- 可工作时段内和嫌疑人在同一地点时，行动里会出现抓捕选项。对方可能拒捕动手：赢了带走，输了他挣脱潜伏；动手耗体力，可能受伤。\n- 闹事记录还有效的人抓到算正常抓捕，带走即结案；他要是已经醉倒或正睡宿醉那一觉，弄醒了也迷迷糊糊，不会反抗，直接带走。\n- 抓既没有在办案件、也没有有效闹事记录的人是判断失误：当天工资直接归零，之后再抓到真罪犯也补不回来。有人说某人是坏人不等于他有案子，案件和闹事记录是唯一依据。\n\n## 工资\n\n- 你的可工作时段是连续上7天、休7天，每天一个8小时的窗口（白班 / 晚班 / 夜班每14天轮换）。窗口内抓到1人就拿满这一班的工资并当天收工；没抓到人这一天没有工资。连续3个工作日都没抓到人会被解约。"
  },
  {
   "key": "doctor",
   "title": "门诊接诊",
   "content_md": "## 你的职责\n\n坐诊接待挂号候诊的病人。病人只说得出哪儿难受、多难受；根据主诉、追问和检查选择本次诊断。\n\n## 你能看出多少，取决于你的医术\n\n同一个部位下有好几种病，用药完全不同；医术越高能排除的越多，直到确诊是什么病、多重。检查信息和诊断候选使用同一套病情名称，内科程度由检查提供。\n\n## 问诊与后果\n\n- 叫号 → 病人说哪儿不舒服 → 你追问一句 → 他回答 → 你下判断并处置。追问那一句是你唯一能主动获取信息的机会。\n- 「下判断并处置」选择本次诊断：外伤对应检查伤处并处置；内科小病对应对症药物治疗，中病或大病对应住院。病伤并存时，一次诊疗处理本次诊断对应的问题。\n- 完整诊疗后收取门诊费，现金不足由银行垫付。误诊照常计费。诊断对应的问题在诊疗结束前自愈，本次费用免收。\n\n## 绩效与医术\n\n- 你的可工作时段是连续上7天、休7天，每天一个8小时的窗口（白班 / 晚班 / 夜班每14天轮换），窗口内人在门诊就能接诊。疾病链和严重程度都判对才算判对。窗口内判对一位病人、整理完一轮病历各绩效 +1，误诊不算，绩效满额 6 拿满这一班的工资并当天收工，不满按绩效拿；没人候诊时整理病历照样攒绩效。连续3个工作日绩效不到满额三成会被解约。\n- 医术靠图书馆自学和接诊积累，判错也长本事。"
  },
  {
   "key": "reporter",
   "title": "采写与交稿",
   "content_md": "# 记者手册\n\n- 每天 0 点报社给你一个报道主题，当天写出一篇相关的署名报道交上去。\n- 报道必须靠当天真实的采访：有人接受你的采访并且真的回答了才算数。\n- 采访是当面一问一答，问具体的事——他看见了什么、做了什么、怎么想的；空泛的寒暄写不出报道。\n- 凑够三个人的有效回答才能动笔，拿到六个就不必再采。被拒访不占数。一篇最多三段。\n- 交稿才算完成当天的活，当场拿满额工资；当天没交，这一天一分钱没有。"
  },
  {
   "key": "renovation",
   "title": "装修零工",
   "content_md": "# 装修工须知\n\n- 先选「接装修单」，按下单日领取最早且接单人数未满的订单，同日按楼栋、门牌排序。接好后到对应工地「干一小时装修」，一人同时接一户。\n- 工钱每满一小时现结，中途停工按分钟折算，已做工时保留。\n- 接单后连续24小时未施工，订单自动解除；每次施工后重新计时。\n- 全户工时做满交付，工人收工结薪。完工或撤场时全部订单结束；辞职或被拘捕时解除本人的订单。订单结束后可再接单。"
  },
  {
   "key": "housing",
   "title": "买房与搬家",
   "content_md": "# 买房与搬家须知\n\n- 公租房可独住或两人同住，费用按人结算。先租空房，再在找房App「邀请一起住」；也可「申请一起住」搬到联系人的公租房。双方确认后才搬家，生效前照旧住原处。各自可退租，一人离开后另一人的租金和居住权保持原样。\n- 商品房只卖不租，名下最多一套。在找房App全款订一户毛坯，产权当场归你，房子进入装修；房价与所需工时见房源。\n- 装修工共同积累这户的工时，做满才交付。交付前照旧住原处，不能搬入或卖房。你可以回自己那户看现场，也可以打开找房App查进度。\n- 交付后，在找房App选择「搬进自己的房子」。搬家会自动退掉原公租房或结束原借住；住进自有房后没有日常住房支出。\n- 交付后可以「卖掉房子」，到手金额见选项。卖房立即成交，房子回到毛坯；若你住在里面，就会和借住者一起搬出，你装的家电退回背包。若还住在别处，原住处不受影响。"
  }
 ],
 "fishing_catalog": [
  {
   "template_id": "tpl:ingredient.fish",
   "rarity": "common"
  },
  {
   "template_id": "tpl:ingredient.shrimp",
   "rarity": "common"
  },
  {
   "template_id": "tpl:misc.broken_boot",
   "rarity": "common"
  },
  {
   "template_id": "tpl:ingredient.sea_bass",
   "rarity": "rare"
  },
  {
   "template_id": "tpl:ingredient.crab",
   "rarity": "rare"
  },
  {
   "template_id": "tpl:ingredient.squid",
   "rarity": "rare"
  },
  {
   "template_id": "tpl:ingredient.yellow_croaker",
   "rarity": "epic"
  },
  {
   "template_id": "tpl:ingredient.lobster",
   "rarity": "epic"
  },
  {
   "template_id": "tpl:fishing.pearl",
   "rarity": "epic"
  },
  {
   "template_id": "tpl:ingredient.bluefin_tuna",
   "rarity": "legendary"
  },
  {
   "template_id": "tpl:fishing.antique_watch",
   "rarity": "legendary"
  }
 ],
 "buff_descriptions": {
  "stamina_recovery": {
   "1": "体力恢复速度增加 10%",
   "2": "体力恢复速度增加 20%",
   "3": "体力恢复速度增加 35%",
   "4": "体力恢复速度增加 50%"
  },
  "stamina_saver": {
   "1": "体力消耗减少 5%",
   "2": "体力消耗减少 10%",
   "3": "体力消耗减少 15%",
   "4": "体力消耗减少 20%"
  },
  "satiety_saver": {
   "1": "饱食消耗减少 5%",
   "2": "饱食消耗减少 10%",
   "3": "饱食消耗减少 15%",
   "4": "饱食消耗减少 20%"
  },
  "sickness_resist": {
   "1": "抵抗疾病更有利",
   "2": "抵抗疾病更有利",
   "3": "抵抗疾病更有利",
   "4": "抵抗疾病更有利"
  },
  "recovery_boost": {
   "1": "自愈更有利; 疾病恢复负担减少 10%",
   "2": "自愈更有利; 疾病恢复负担减少 20%",
   "3": "自愈更有利; 疾病恢复负担减少 30%",
   "4": "自愈更有利; 疾病恢复负担减少 40%"
  },
  "exp_boost": {
   "1": "技能经验增加 10%",
   "2": "技能经验增加 20%",
   "3": "技能经验增加 35%",
   "4": "技能经验增加 50%"
  },
  "cooking_speed": {
   "1": "制作速度增加 10%",
   "2": "制作速度增加 20%",
   "3": "制作速度增加 35%",
   "4": "制作速度增加 50%"
  },
  "fishing_luck": {
   "1": "稀有渔获更有利",
   "2": "稀有渔获更有利",
   "3": "稀有渔获更有利",
   "4": "稀有渔获更有利"
  },
  "dish_research_luck": {
   "1": "研发成功更有利",
   "2": "研发成功更有利",
   "3": "研发成功更有利",
   "4": "研发成功更有利"
  },
  "tailoring_luck": {
   "1": "高品质成衣更有利",
   "2": "高品质成衣更有利",
   "3": "高品质成衣更有利",
   "4": "高品质成衣更有利"
  },
  "mood_boost": {
   "1": "心情增加速率增加 10%",
   "2": "心情增加速率增加 20%",
   "3": "心情增加速率增加 35%",
   "4": "心情增加速率增加 50%"
  },
  "animal_affinity": {
   "1": "野猫发现概率增加 5%; 驯服信任增长速度增加 5%",
   "2": "野猫发现概率增加 10%; 驯服信任增长速度增加 10%",
   "3": "野猫发现概率增加 15%; 驯服信任增长速度增加 15%",
   "4": "野猫发现概率增加 20%; 驯服信任增长速度增加 20%"
  }
 },
 "effect_source_labels": {
  "food:stamina_recovery": "好眠",
  "food:stamina_saver": "充沛",
  "food:satiety_saver": "顶饱",
  "food:sickness_resist": "强身",
  "food:recovery_boost": "滋补",
  "food:exp_boost": "悟性",
  "food:cooking_speed": "利落",
  "food:fishing_luck": "渔运",
  "food:dish_research_luck": "灵感",
  "food:tailoring_luck": "巧手",
  "food:mood_boost": "逸兴",
  "clothing:stamina_recovery": "好眠",
  "clothing:stamina_saver": "充沛",
  "clothing:exp_boost": "悟性",
  "clothing:cooking_speed": "利落",
  "clothing:fishing_luck": "渔运",
  "clothing:dish_research_luck": "灵感",
  "clothing:tailoring_luck": "巧手",
  "clothing:animal_affinity": "动物亲和",
  "drink:mean_drunk": "酒疯",
  "drink:heart_on_sleeve": "浓情",
  "drink:songbird": "吟啸",
  "drink:hollow_legs": "鲸吞",
  "drink:liquid_courage": "无畏",
  "drink:wired": "亢奋",
  "drink:big_spender": "散财",
  "drink:carefree": "无忧",
  "mood:good": "心情好",
  "mood:normal": "一般",
  "mood:low": "心情不好",
  "injury:abrasion": "擦伤",
  "injury:contusion": "挫伤",
  "night:early_morning": "清晨",
  "night:morning": "上午",
  "night:noon": "中午",
  "night:afternoon": "下午",
  "night:evening": "傍晚",
  "night:night": "夜晚",
  "night:late_night": "深夜",
  "drunk:sober": "清醒",
  "drunk:tipsy": "微醺",
  "drunk:drunk": "醉了",
  "drunk:wasted": "烂醉",
  "skill:cooking": "烹饪",
  "skill:bartending": "调酒",
  "skill:tailoring": "裁缝",
  "fitness": "体能",
  "exhausted": "精疲力尽",
  "hungry": "饥饿",
  "hangover": "宿醉",
  "illness": "身体不适",
  "comfortable_sleep": "舒适睡眠",
  "home_warmth": "住宅温馨值",
  "kitchen": "专业后厨"
 },
 "effect_source_meanings": {
  "food:stamina_recovery": "睡得更解乏",
  "food:stamina_saver": "干活省力",
  "food:satiety_saver": "更晚饿",
  "food:sickness_resist": "不易生病",
  "food:recovery_boost": "病好得快",
  "food:exp_boost": "技能学得快",
  "food:cooking_speed": "制作更快",
  "food:fishing_luck": "易钓稀有渔获",
  "food:dish_research_luck": "研发菜酒更易成功",
  "food:tailoring_luck": "做衣服更易出好货",
  "food:mood_boost": "放松休闲时心情好得更快",
  "clothing:stamina_recovery": "睡得更解乏",
  "clothing:stamina_saver": "干活省力",
  "clothing:exp_boost": "技能学得快",
  "clothing:cooking_speed": "制作更快",
  "clothing:fishing_luck": "易钓稀有渔获",
  "clothing:dish_research_luck": "研发菜酒更易成功",
  "clothing:tailoring_luck": "做衣服更易出好货",
  "clothing:animal_affinity": "更易找到野猫，与猫熟悉得更快",
  "drink:mean_drunk": "看谁都不顺眼，想找人动手",
  "drink:heart_on_sleeve": "心事藏不住，想向心里那个人表白",
  "drink:songbird": "想上台唱歌",
  "drink:hollow_legs": "越喝越想喝",
  "drink:liquid_courage": "不躲不让，打起来更猛",
  "drink:wired": "酒劲让人坐不住，不想睡，只想接着折腾",
  "drink:big_spender": "想请身边的人一起喝",
  "drink:carefree": "忙碌时心情不容易变差",
  "mood:good": "心情好",
  "mood:normal": "一般",
  "mood:low": "心情不好",
  "injury:abrasion": "擦伤",
  "injury:contusion": "挫伤",
  "night:early_morning": "清晨",
  "night:morning": "上午",
  "night:noon": "中午",
  "night:afternoon": "下午",
  "night:evening": "傍晚",
  "night:night": "夜晚",
  "night:late_night": "深夜",
  "drunk:sober": "清醒",
  "drunk:tipsy": "微醺",
  "drunk:drunk": "醉了",
  "drunk:wasted": "烂醉",
  "skill:cooking": "烹饪",
  "skill:bartending": "调酒",
  "skill:tailoring": "裁缝",
  "fitness": "体能",
  "exhausted": "精疲力尽",
  "hungry": "饥饿",
  "hangover": "宿醉",
  "illness": "身体不适",
  "comfortable_sleep": "舒适睡眠",
  "home_warmth": "在家休息或睡觉时，家具带来的温馨感让体力恢复和心情改善得更快。",
  "kitchen": "专业后厨"
 },
 "effect_source_values": {
  "food:stamina_recovery": {
   "1": {
    "stamina_recovery": 0.1
   },
   "2": {
    "stamina_recovery": 0.2
   },
   "3": {
    "stamina_recovery": 0.35
   },
   "4": {
    "stamina_recovery": 0.5
   }
  },
  "food:stamina_saver": {
   "1": {
    "stamina_cost": -0.05
   },
   "2": {
    "stamina_cost": -0.1
   },
   "3": {
    "stamina_cost": -0.15
   },
   "4": {
    "stamina_cost": -0.2
   }
  },
  "food:satiety_saver": {
   "1": {
    "satiety_cost": -0.05
   },
   "2": {
    "satiety_cost": -0.1
   },
   "3": {
    "satiety_cost": -0.15
   },
   "4": {
    "satiety_cost": -0.2
   }
  },
  "food:sickness_resist": {
   "1": {},
   "2": {},
   "3": {},
   "4": {}
  },
  "food:recovery_boost": {
   "1": {
    "disease_penalty": -0.1
   },
   "2": {
    "disease_penalty": -0.2
   },
   "3": {
    "disease_penalty": -0.3
   },
   "4": {
    "disease_penalty": -0.4
   }
  },
  "food:exp_boost": {
   "1": {
    "experience": 0.1
   },
   "2": {
    "experience": 0.2
   },
   "3": {
    "experience": 0.35
   },
   "4": {
    "experience": 0.5
   }
  },
  "food:cooking_speed": {
   "1": {
    "production_speed": 0.1
   },
   "2": {
    "production_speed": 0.2
   },
   "3": {
    "production_speed": 0.35
   },
   "4": {
    "production_speed": 0.5
   }
  },
  "food:fishing_luck": {
   "1": {},
   "2": {},
   "3": {},
   "4": {}
  },
  "food:dish_research_luck": {
   "1": {},
   "2": {},
   "3": {},
   "4": {}
  },
  "food:tailoring_luck": {
   "1": {},
   "2": {},
   "3": {},
   "4": {}
  },
  "food:mood_boost": {
   "1": {
    "mood_gain": 0.1
   },
   "2": {
    "mood_gain": 0.2
   },
   "3": {
    "mood_gain": 0.35
   },
   "4": {
    "mood_gain": 0.5
   }
  },
  "clothing:stamina_recovery": {
   "1": {
    "stamina_recovery": 0.1
   },
   "2": {
    "stamina_recovery": 0.2
   },
   "3": {
    "stamina_recovery": 0.35
   },
   "4": {
    "stamina_recovery": 0.5
   }
  },
  "clothing:stamina_saver": {
   "1": {
    "stamina_cost": -0.05
   },
   "2": {
    "stamina_cost": -0.1
   },
   "3": {
    "stamina_cost": -0.15
   },
   "4": {
    "stamina_cost": -0.2
   }
  },
  "clothing:exp_boost": {
   "1": {
    "experience": 0.1
   },
   "2": {
    "experience": 0.2
   },
   "3": {
    "experience": 0.35
   },
   "4": {
    "experience": 0.5
   }
  },
  "clothing:cooking_speed": {
   "1": {
    "production_speed": 0.1
   },
   "2": {
    "production_speed": 0.2
   },
   "3": {
    "production_speed": 0.35
   },
   "4": {
    "production_speed": 0.5
   }
  },
  "clothing:fishing_luck": {
   "1": {},
   "2": {},
   "3": {},
   "4": {}
  },
  "clothing:dish_research_luck": {
   "1": {},
   "2": {},
   "3": {},
   "4": {}
  },
  "clothing:tailoring_luck": {
   "1": {},
   "2": {},
   "3": {},
   "4": {}
  },
  "clothing:animal_affinity": {
   "1": {
    "taming_chance": 0.05,
    "taming_trust": 0.05
   },
   "2": {
    "taming_chance": 0.1,
    "taming_trust": 0.1
   },
   "3": {
    "taming_chance": 0.15,
    "taming_trust": 0.15
   },
   "4": {
    "taming_chance": 0.2,
    "taming_trust": 0.2
   }
  },
  "drink:mean_drunk": {
   "0": {}
  },
  "drink:heart_on_sleeve": {
   "0": {}
  },
  "drink:songbird": {
   "0": {}
  },
  "drink:hollow_legs": {
   "0": {}
  },
  "drink:liquid_courage": {
   "0": {
    "attack": 0.4,
    "defense": 0.4,
    "combat_speed": 0.4
   }
  },
  "drink:wired": {
   "0": {}
  },
  "drink:big_spender": {
   "0": {}
  },
  "drink:carefree": {
   "0": {
    "mood_loss": -0.2
   }
  }
 },
 "effect_labels": {
  "stamina_recovery": "体力恢复速度",
  "stamina_cost": "体力消耗",
  "satiety_cost": "饱食消耗",
  "mood_gain": "心情增加速率",
  "mood_loss": "心情减少速率",
  "experience": "技能经验",
  "production_speed": "制作速度",
  "sickness_weight": "抵抗疾病",
  "self_heal_weight": "自愈",
  "disease_penalty": "疾病恢复负担",
  "fishing_weight": "稀有渔获",
  "research_weight": "研发成功",
  "tailoring_weight": "高品质成衣",
  "taming_chance": "野猫发现概率",
  "taming_trust": "驯服信任增长速度",
  "attack": "攻击",
  "defense": "防御",
  "combat_speed": "战斗速度"
 },
 "effect_scope_labels": {
  "all": "通用",
  "activity": "活动",
  "sleep": "睡眠",
  "cooking": "烹饪",
  "bartending": "调酒",
  "tailoring": "裁缝",
  "leisure": "休闲",
  "singing": "唱歌"
 },
 "attribute_base_rates": {
  "stamina_cost": 2.0,
  "satiety_cost": 3.0,
  "rest_recovery": 10.0,
  "sleep_recovery": 17.0
 },
 "dish_effect_duration_hours": {
  "stamina_recovery": 8.0,
  "stamina_saver": 8.0,
  "satiety_saver": 8.0,
  "sickness_resist": 72.0,
  "recovery_boost": 72.0,
  "exp_boost": 8.0,
  "cooking_speed": 8.0,
  "fishing_luck": 8.0,
  "dish_research_luck": 8.0,
  "tailoring_luck": 8.0,
  "mood_boost": 8.0
 },
 "clothing_buff_tier_by_rarity": {
  "common": 1,
  "rare": 2,
  "epic": 3,
  "legendary": 4
 },
 "scene_by_place": {
  "place:residential.street": "residential_street",
  "place:residential.garden": "garden",
  "place:commercial.street": "commercial_street",
  "place:commercial.clothing_store": "clothing_store",
  "place:commercial.ice_cream_shop": "ice_cream_shop",
  "place:commercial.appliance_store": "appliance_store",
  "place:downtown.street": "downtown_street",
  "place:downtown.hospital": "hospital",
  "place:downtown.library": "library",
  "place:downtown.prison": "prison",
  "place:office.street": "office_street",
  "place:agriculture.street": "agriculture_street",
  "place:outdoor.park": "park",
  "place:outdoor.beach": "beach"
 }
} as const
