# NanoVoices

NanoVoices es un ranking voluntario de cuentas Nano (XNO). Una cuenta aparece solo cuando su propietario publica un mensaje y demuestra control enviando exactamente `0,01 XNO` desde esa misma cuenta hacia la cuenta receptora oficial.

Cada transferencia válida autoriza una publicación o actualización. No hay registro, correo, contraseña, alias ni perfiles tradicionales: la identidad pública es la dirección Nano.

## Arquitectura

- Next.js con TypeScript para UI y API.
- Tailwind CSS para la interfaz.
- PostgreSQL como base de datos.
- Prisma para modelo, migraciones y transacciones.
- Worker separado (`npm run worker`) para WebSocket Nano, recuperación RPC y saldos.
- RPC y WebSocket Nano solo desde backend. Nunca se exponen al navegador.

## Requisitos

- Node.js 20.
- PostgreSQL 16 o compatible.
- Nodo Nano propio o RPC privado/proxy seguro.
- WebSocket del nodo Nano recomendado para confirmaciones rápidas.

## Instalación

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

En otra terminal:

```bash
npm run worker
```

## Variables de Entorno

- `DATABASE_URL`: conexión PostgreSQL.
- `NANO_RPC_URL`: URL privada del RPC Nano.
- `NANO_RPC_FALLBACK_URLS`: RPC alternos separados por coma.
- `NANO_RPC_TOKEN`: token opcional para un proxy RPC.
- `NANO_WS_URL`: WebSocket del nodo Nano.
- `NANOVOICES_RECEIVER_ADDRESS`: cuenta oficial receptora.
- `REQUIRED_PAYMENT_RAW`: debe ser `10000000000000000000000000000`.
- `NANO_EXPLORER_ACCOUNT_URL`: plantilla con `{address}`.
- `PUBLIC_APP_URL`: URL pública, por ejemplo `https://nanovoices.com`.
- `BALANCE_REFRESH_SECONDS`: intervalo de actualización de saldos. Recomendado: `60`.
- `REQUEST_EXPIRATION_MINUTES`: vencimiento inicial de solicitudes, por defecto 15.
- `PAYMENT_RECOVERY_INTERVAL_SECONDS`: frecuencia del recuperador RPC.
- `PAYMENT_RECOVERY_HISTORY_COUNT`: ventana de historial revisada en la cuenta receptora.
- `ADMIN_USERNAME` y `ADMIN_PASSWORD`: credenciales del panel.

## PostgreSQL y Prisma

```bash
npm run db:migrate
npm run db:generate
```

En producción:

```bash
npm run db:deploy
```

## Nodo Nano

El backend usa:

- `block_info` con `json_block=true` para verificar hash, emisor, destino, subtipo, confirmación e importe.
- `receivable` de la cuenta receptora para pagos confirmados pendientes de recibir.
- `account_history` de la cuenta receptora para recuperación de bloques ya recibidos.
- `accounts_balances` para consultar solo cuentas verificadas.
- `nano_to_raw` si el nodo lo soporta, para confirmar que `0.01` XNO equivale a `10000000000000000000000000000` raw.

El RPC puede vivir detrás de red privada, túnel o proxy autenticado. No debe publicarse directamente en internet.

## Funcionamiento de Pagos

1. El usuario crea una solicitud con dirección, mensaje y visibilidad del saldo.
2. La solicitud vence en 15 minutos.
3. Se muestra una única cuenta receptora y un QR `nano:` con el importe raw exacto.
4. El worker escucha confirmaciones por WebSocket.
5. Cada hash se verifica por RPC.
6. El bloque debe ser `send`, confirmado, hacia la cuenta receptora, desde la dirección indicada y por el raw exacto.
7. Dentro de una transacción se registra `Payment`, se completa `PublicationRequest`, se crea/actualiza `VerifiedAccount` y se guarda `MessageHistory`.
8. Si la solicitud es una respuesta, se crea o reemplaza una `Reply` dentro del subranking del mensaje respondido.

Si el pago no coincide con una solicitud pendiente, se guarda como no asociado y no publica nada.

Cada mensaje principal tiene una URL permanente con su propio subranking de respuestas. Responder cuesta también `0,01 XNO`, usa la misma cuenta receptora oficial y exige que el pago salga desde la cuenta Nano escrita en el formulario de respuesta. Las respuestas se ordenan por saldo confirmado de la cuenta que responde.

## Recuperación Después de Reinicios

El worker revisa periódicamente `receivable` y `account_history` de la cuenta receptora. Si encuentra un bloque `receive` u `open`, resuelve su `contents.link` al bloque `send` original antes de validar. Esto cubre desconexiones WebSocket, reinicios, pagos pendientes de recibir y notificaciones duplicadas. `Payment.blockHash` es único, por lo que el mismo bloque de envío no puede publicar dos veces.

## Ranking y Saldos

Solo se consultan direcciones registradas en NanoVoices. No se recorre el ledger. El ranking principal se ordena por `cachedBalanceRaw` descendente y, en empate, por la verificación más antigua. Los subrankings de respuestas se ordenan por saldo confirmado descendente y, en empate, por la respuesta más antigua. Si una cuenta oculta el saldo, la API pública no envía el saldo exacto.

## Administración

El panel `/admin` usa Basic Auth. Permite ver publicaciones, ocultar/restaurar mensajes, revisar historial reciente y pagos no asociados. Las acciones se guardan en `AdminAudit`.

## Docker

```bash
docker compose up --build
```

Servicios:

- `postgres`
- `web`
- `worker`

Antes de producción, cambia las credenciales, usa una contraseña fuerte y configura `PUBLIC_APP_URL=https://nanovoices.com`.

## Seguridad

- RPC Nano solo en backend.
- Sin seeds ni llaves privadas.
- Validación real de direcciones Nano con checksum Blake2b.
- Mensajes limitados a 300 caracteres y renderizados como texto por React.
- Rate limiting básico en memoria para crear solicitudes.
- Hashes de pago únicos.
- Transacciones Prisma para publicación.
- Worker idempotente.
- Panel admin protegido.
- Variables de entorno para secretos.

Para producción conviene colocar rate limiting persistente en Redis o en el proxy, TLS obligatorio, logs centralizados y backups automatizados.

## Copias de Respaldo

Haz backups periódicos de PostgreSQL:

```bash
pg_dump "$DATABASE_URL" > nanovoices-backup.sql
```

Conserva especialmente tablas `Payment`, `PublicationRequest`, `VerifiedAccount`, `MessageHistory` y `AdminAudit`, porque contienen la evidencia de publicación y moderación.

## Pruebas

```bash
npm test
```

Las pruebas iniciales cubren la conversión de `0,01 XNO` a raw y la validación crítica de bloques de pago.
