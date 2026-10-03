# Mapa da camada WhatsApp

| Componente UnoAPI | Responsabilidade preservada | Componente Zapo |
| --- | --- | --- |
| `client_baileys.ts` | conexão, envio, leitura, contatos e metadados | `client_zapo.ts` |
| `socket.ts` | ciclo de sessão, QR, pareamento, presença e reconexão | `socket_zapo.ts` |
| `incoming_baileys.ts` | entrada de mensagens da API para o provedor | `incoming_zapo.ts` |
| `listener_baileys.ts` | normalização e entrega de eventos/webhooks | `listener_zapo.ts` |
| `contact_baileys.ts` | validação de números | `contact_zapo.ts` |
| `logout_baileys.ts` | logout e limpeza de caches UnoAPI | `logout_zapo.ts` |
| `reload_baileys.ts` | recarga da sessão | `reload_zapo.ts` |
| `sync_baileys.ts` | tentativa de sincronização após falha de descriptografia | `sync_zapo.ts` |
| `transformer.ts` | contrato Cloud API e representação Baileys | `transformer_zapo.ts` + transformador existente |

## Fronteira de persistência

Há duas categorias distintas no mesmo Redis:

- dados funcionais da UnoAPI: permanecem com as chaves e os TTLs atuais;
- estado criptográfico e cache do Zapo: usam `ZAPO_REDIS_PREFIX`, padrão `zapo:`.

Essa separação impede colisões sem introduzir outro Redis nem alterar a topologia existente.
