import Redis from 'ioredis'
import { createStore, type WaClient, type WaStore, type WaStoreSession } from 'zapo-js'
import { createRedisStore } from '@zapo-js/store-redis'
import { REDIS_URL, ZAPO_REDIS_PREFIX } from '../defaults'
import { zapoLogger } from './logger_zapo'

let zapoStore: WaStore | undefined
let zapoRedis: Redis | undefined
const sessionCleanups = new Map<string, Promise<void>>()

type ZapoAuthClient = Pick<WaClient, 'auth'>

export const runZapoSessionCleanup = (phone: string, cleanup: () => Promise<void>) => {
  const previousCleanup = sessionCleanups.get(phone) || Promise.resolve()
  const currentCleanup = previousCleanup.catch(() => undefined).then(cleanup)
  const trackedCleanup: Promise<void> = currentCleanup.finally(() => {
    if (sessionCleanups.get(phone) === trackedCleanup) {
      sessionCleanups.delete(phone)
    }
  })
  sessionCleanups.set(phone, trackedCleanup)
  return trackedCleanup
}

export const waitForZapoSessionCleanup = async (phone: string) => {
  await sessionCleanups.get(phone)
}

export const clearZapoSessionState = async (session: WaStoreSession) => {
  await Promise.all([
    session.auth.clear(),
    session.signal.clear(),
    session.preKey.clear(),
    session.session.clear(),
    session.identity.clear(),
    session.senderKey.clear(),
    session.appState.clear(),
    session.privacyToken.clear(),
  ])
  await session.destroyCaches()
}

export const ensureZapoSignalState = async (session: WaStoreSession, client: ZapoAuthClient) => {
  const [registrationInfo, signedPreKey] = await Promise.all([session.signal.getRegistrationInfo(), session.signal.getSignedPreKey()])
  if (registrationInfo && signedPreKey) {
    return false
  }

  const credentials = await session.auth.load()
  if (!credentials?.meJid) {
    throw new Error('A sessão Zapo foi conectada sem credenciais de autenticação persistidas.')
  }

  await client.auth.loadOrCreateCredentials()
  const [restoredRegistrationInfo, restoredSignedPreKey] = await Promise.all([session.signal.getRegistrationInfo(), session.signal.getSignedPreKey()])
  if (!restoredRegistrationInfo || !restoredSignedPreKey) {
    throw new Error('Não foi possível restaurar o estado criptográfico Signal da sessão Zapo.')
  }
  return true
}

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
