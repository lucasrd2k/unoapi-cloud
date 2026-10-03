# Baseline da migração UnoAPI → Zapo

## Origem congelada

- Repositório: `clairton/unoapi-cloud`.
- Tag: `v2.11.7`.
- Commit: `96a3eec6d7aa9767346eeb6f18a3a9f9f686e526`.
- Branch local de trabalho: `migration/zapo-provider`.

## Regra de preservação

A migração substitui somente a camada que conversa diretamente com o WhatsApp. Permanecem compatíveis e com os mesmos contratos externos:

- endpoints HTTP e respostas no formato Cloud API;
- filas, exchanges e routing keys do RabbitMQ;
- chaves funcionais, configurações e status de sessão mantidos pela UnoAPI no Redis;
- webhooks, S3/MinIO, autenticação HTTP, blacklist, templates e transcrição;
- modos `simple`, `standalone`, `web`, `cloud`, `broker`, `worker` e `bridge`;
- porta, nomes de serviços e entrypoints existentes.

## Serviços paralelos obrigatórios

O provedor Zapo terá implementações explícitas equivalentes às da UnoAPI:

1. `client_zapo.ts`;
2. `incoming_zapo.ts`;
3. `listener_zapo.ts`;
4. `contact_zapo.ts`;
5. `logout_zapo.ts`;
6. `reload_zapo.ts`.

Também fazem parte da camada: `socket_zapo.ts`, `store_zapo.ts`, `transformer_zapo.ts` e `sync_zapo.ts`.

Baileys continuará disponível durante a validação de regressão e será o padrão até a homologação completa do Zapo.
