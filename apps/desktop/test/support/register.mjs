/** 注册解析 / 加载钩子（node --import 装载本文件即可）。 */
import { register } from 'node:module'

register('./resolve-ts.mjs', import.meta.url)
