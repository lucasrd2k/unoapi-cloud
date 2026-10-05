import { clients } from '../../src/services/client'
import { getClientZapo } from '../../src/services/client_zapo'
import { configs, defaultConfig } from '../../src/services/config'
import { dataStores } from '../../src/services/data_store'
import { mediaStores } from '../../src/services/media_store'
import { stores } from '../../src/services/store'

describe('ciclo de vida do cliente Zapo', () => {
  const phone = '5511999999999'

  afterEach(() => {
    clients.clear()
    configs.clear()
    dataStores.clear()
    mediaStores.clear()
    stores.clear()
    jest.clearAllMocks()
  })

  test('compartilha a criação do cliente entre chamadas simultâneas', async () => {
    const getConfig = jest.fn(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      return { ...defaultConfig, provider: 'zapo' as const, autoConnect: false }
    })
    const listener = { process: jest.fn().mockResolvedValue(undefined) }
    const onNewLogin = jest.fn().mockResolvedValue(undefined)

    const createdClients = await Promise.all(Array.from({ length: 5 }, () => getClientZapo({ phone, listener, getConfig, onNewLogin })))

    expect(getConfig).toHaveBeenCalledTimes(1)
    expect(new Set(createdClients).size).toBe(1)
    expect(clients.get(phone)).toBe(createdClients[0])
  })
})
