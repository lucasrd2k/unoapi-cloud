import { logoutOrDisconnectZapo } from '../../src/services/socket_zapo'

describe('encerramento de sessão Zapo', () => {
  test('desconecta sem chamar logout quando a sessão ainda não foi autenticada', async () => {
    const client = {
      getCredentials: jest.fn().mockReturnValue(null),
      disconnect: jest.fn().mockResolvedValue(undefined),
      logout: jest.fn().mockResolvedValue(undefined),
    }

    await expect(logoutOrDisconnectZapo(client)).resolves.toBe('disconnect')
    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(client.logout).not.toHaveBeenCalled()
  })

  test('usa logout quando a sessão está autenticada', async () => {
    const client = {
      getCredentials: jest.fn().mockReturnValue({ meJid: '5511999999999:1@s.whatsapp.net' }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      logout: jest.fn().mockResolvedValue(undefined),
    }

    await expect(logoutOrDisconnectZapo(client)).resolves.toBe('logout')
    expect(client.logout).toHaveBeenCalledTimes(1)
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  test('desconecta localmente quando o logout remoto falha', async () => {
    const client = {
      getCredentials: jest.fn().mockReturnValue({ meJid: '5511999999999:1@s.whatsapp.net' }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      logout: jest.fn().mockRejectedValue(new Error('falha simulada')),
    }

    await expect(logoutOrDisconnectZapo(client)).resolves.toBe('disconnect')
    expect(client.logout).toHaveBeenCalledTimes(1)
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })
})
