import { clients } from '../../src/services/client'
import { configs } from '../../src/services/config'
import { dataStores } from '../../src/services/data_store'
import { mediaStores } from '../../src/services/media_store'
import { ReloadZapo } from '../../src/services/reload_zapo'
import { stores } from '../../src/services/store'
import { UNOAPI_SERVER_NAME } from '../../src/defaults'

describe('recarga de sessão Zapo', () => {
  const phone = '5511999999999'

  afterEach(() => {
    clients.clear()
    configs.clear()
    dataStores.clear()
    mediaStores.clear()
    stores.clear()
    jest.clearAllMocks()
  })

  const dependencies = () => {
    const sessionStore = {
      setStatus: jest.fn().mockResolvedValue(undefined),
    }
    const config = {
      server: UNOAPI_SERVER_NAME,
      getStore: jest.fn().mockResolvedValue({ sessionStore }),
    }
    const newClient = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      logout: jest.fn(),
      send: jest.fn(),
      getMessageMetadata: jest.fn(),
      contacts: jest.fn(),
    }
    const getClient = jest.fn().mockResolvedValue(newClient)
    const getConfig = jest.fn().mockResolvedValue(config)
    const listener = { process: jest.fn() }
    const onNewLogin = jest.fn()
    return { sessionStore, newClient, getClient, getConfig, listener, onNewLogin }
  }

  test('cria somente o cliente final quando ainda não existe cliente em memória', async () => {
    const deps = dependencies()
    const reload = new ReloadZapo(deps.getClient, deps.getConfig, deps.listener, deps.onNewLogin)

    await reload.run(phone)

    expect(deps.getClient).toHaveBeenCalledTimes(1)
    expect(deps.newClient.disconnect).not.toHaveBeenCalled()
    expect(deps.sessionStore.setStatus).toHaveBeenNthCalledWith(1, phone, 'online')
    expect(deps.sessionStore.setStatus).toHaveBeenNthCalledWith(2, phone, 'disconnected')
  })

  test('encerra o cliente existente antes de criar a nova conexão', async () => {
    const deps = dependencies()
    const currentClient = { ...deps.newClient, disconnect: jest.fn().mockResolvedValue(undefined) }
    clients.set(phone, currentClient)
    const reload = new ReloadZapo(deps.getClient, deps.getConfig, deps.listener, deps.onNewLogin)

    await reload.run(phone)

    expect(currentClient.disconnect).toHaveBeenCalledTimes(1)
    expect(deps.getClient).toHaveBeenCalledTimes(1)
  })
})
