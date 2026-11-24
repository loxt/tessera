import type { Engine } from '@shared/model'
import type { Adapter } from './types'
import { postgres } from './postgres'
import { mysql } from './mysql'
import { sqlite } from './sqlite'

const adapters: Record<Engine, Adapter> = { postgres, mysql, sqlite }

export const adapterFor = (engine: Engine): Adapter => adapters[engine]
