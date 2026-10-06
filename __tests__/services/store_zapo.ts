import type { WaStoreSession } from 'zapo-js'
import { clearZapoSessionState, ensureZapoSignalState, runZapoSessionCleanup, waitForZapoSessionCleanup } from '../../src/services/store_zapo'

const createSession = () => {
  const auth = {
    clear: jest.fn().mockResolvedValue(undefined),
    load: jest.fn(),
  }
  const signal = {
    clear: jest.fn().mockResolvedValue(undefined),
    getRegistrationInfo: jest.fn(),
    getSignedPreKey: jest.fn(),
  }
  const clearable = () => ({ clear: jest.fn().mockResolvedValue(undefined) })
  const session = {
    auth,
    signal,
    preKey: clearable(),
    session: clearable(),
    identity: clearable(),
    senderKey: clearable(),
    appState: clearable(),
    privacyToken: clearable(),
    messages: clearable(),
    threads: clearable(),
    contacts: clearable(),
    destroyCaches: jest.fn().mockResolvedValue(undefined),
  }
  return { session: session as unknown as WaStoreSession, stores: session }
}

describe('armazenamento de sessão Zapo', () => {
  test('bloqueia uma nova conexão enquanto a limpeza da sessão está em andamento', async () => {
    let releaseCleanup: (() => void) | undefined
    const cleanupBlocked = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const cleanup = runZapoSessionCleanup('5511999999999', () => cleanupBlocked)
    let waitFinished = false
    const waiting = waitForZapoSessionCleanup('5511999999999').then(() => {
      waitFinished = true
    })

    await Promise.resolve()
    expect(waitFinished).toBe(false)

    releaseCleanup?.()
    await Promise.all([cleanup, waiting])
    expect(waitFinished).toBe(true)
  })

  test('limpa o estado criptográfico sem apagar o histórico de mensagens e contatos', async () => {
    const { session, stores } = createSession()

    await clearZapoSessionState(session)

    expect(stores.auth.clear).toHaveBeenCalledTimes(1)
    expect(stores.signal.clear).toHaveBeenCalledTimes(1)
    expect(stores.preKey.clear).toHaveBeenCalledTimes(1)
    expect(stores.session.clear).toHaveBeenCalledTimes(1)
    expect(stores.identity.clear).toHaveBeenCalledTimes(1)
    expect(stores.senderKey.clear).toHaveBeenCalledTimes(1)
    expect(stores.appState.clear).toHaveBeenCalledTimes(1)
    expect(stores.privacyToken.clear).toHaveBeenCalledTimes(1)
    expect(stores.destroyCaches).toHaveBeenCalledTimes(1)
    expect(stores.messages.clear).not.toHaveBeenCalled()
    expect(stores.threads.clear).not.toHaveBeenCalled()
    expect(stores.contacts.clear).not.toHaveBeenCalled()
  })

  test('mantém a sessão pronta quando o registro e a chave assinada existem', async () => {
    const { session, stores } = createSession()
    stores.signal.getRegistrationInfo.mockResolvedValue({ registrationId: 1 })
    stores.signal.getSignedPreKey.mockResolvedValue({ keyId: 1 })
    const client = { auth: { loadOrCreateCredentials: jest.fn() } }

    await expect(ensureZapoSignalState(session, client as never)).resolves.toBe(false)
    expect(client.auth.loadOrCreateCredentials).not.toHaveBeenCalled()
  })

  test('restaura o estado Signal persistido antes de liberar a sessão', async () => {
    const { session, stores } = createSession()
    stores.signal.getRegistrationInfo.mockResolvedValueOnce(null).mockResolvedValueOnce({ registrationId: 1 })
    stores.signal.getSignedPreKey.mockResolvedValueOnce(null).mockResolvedValueOnce({ keyId: 1 })
    stores.auth.load.mockResolvedValue({ meJid: '5511999999999:1@s.whatsapp.net' })
    const client = { auth: { loadOrCreateCredentials: jest.fn().mockResolvedValue(undefined) } }

    await expect(ensureZapoSignalState(session, client as never)).resolves.toBe(true)
    expect(client.auth.loadOrCreateCredentials).toHaveBeenCalledTimes(1)
  })

  test('rejeita uma sessão sem credenciais persistidas', async () => {
    const { session, stores } = createSession()
    stores.signal.getRegistrationInfo.mockResolvedValue(null)
    stores.signal.getSignedPreKey.mockResolvedValue(null)
    stores.auth.load.mockResolvedValue(null)
    const client = { auth: { loadOrCreateCredentials: jest.fn() } }

    await expect(ensureZapoSignalState(session, client as never)).rejects.toThrow(
      'A sessão Zapo foi conectada sem credenciais de autenticação persistidas.',
    )
    expect(client.auth.loadOrCreateCredentials).not.toHaveBeenCalled()
  })
})
