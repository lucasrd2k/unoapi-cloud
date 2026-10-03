import Redis from 'ioredis'
import { createStore, type WaStore } from 'zapo-js'
import { createRedisStore } from '@zapo-js/store-redis'
import { REDIS_URL, ZAPO_REDIS_PREFIX } from '../defaults'
import { zapoLogger } from './logger_zapo'

let zapoStore: WaStore | undefined
let zapoRedis: Redis | undefined

export const getStoreZapo = (): WaStore => {
  if (zapoStore) {
    return zapoStore
  }

  zapoRedis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  })

  const redis = createRedisStore({
    redis: zapoRedis,
    keyPrefix: ZAPO_REDIS_PREFIX,
  })

  zapoStore = createStore({
    logger: zapoLogger,
    backends: { redis },
    providers: {
      auth: 'redis',
      signal: 'redis',
      preKey: 'redis',
      session: 'redis',
      identity: 'redis',
      senderKey: 'redis',
      appState: 'redis',
      messages: 'redis',
      threads: 'redis',
      contacts: 'redis',
      privacyToken: 'redis',
    },
    cacheProviders: {
      retry: 'redis',
      groupMetadata: 'redis',
      chatMetadata: 'redis',
      deviceList: 'redis',
      messageSecret: 'redis',
    },
  })

  return zapoStore
}

export const closeStoreZapo = async () => {
  if (zapoStore) {
    await zapoStore.destroy()
  } else if (zapoRedis) {
    await zapoRedis.quit()
  }
  zapoStore = undefined
  zapoRedis = undefined
}
