# NanoVoices

NanoVoices es un ranking voluntario de cuentas Nano (XNO). Una cuenta aparece cuando su propietario paga exactamente `0,02 XNO` hacia la cuenta receptora oficial y luego guarda un mensaje asociado a la cuenta pagadora detectada.

Cada transferencia válida autoriza una publicación o actualización. No hay registro, correo, contraseña, alias ni perfiles tradicionales.

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
- `REQUIRED_PAYMENT_RAW`: debe ser `20000000000000000000000000000`.
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
- `nano_to_raw` si el nodo lo soporta, para confirmar que `0.02` XNO equivale a `20000000000000000000000000000` raw.

El RPC puede vivir detrás de red privada, túnel o proxy autenticado. No debe publicarse directamente en internet.

## Funcionamiento de Pagos

1. El usuario crea una solicitud de pago en el nivel actual del hilo.
2. La solicitud vence en 15 minutos.
3. Se muestra una única cuenta receptora y un QR `nano:` con el importe raw exacto.
4. El worker escucha confirmaciones por WebSocket.
5. Cada hash se verifica por RPC.
6. El bloque debe ser `send`, confirmado, hacia la cuenta receptora y por el raw exacto.
7. La solicitud reclama un pago confirmado no asociado y usa la cuenta pagadora como identidad.
8. Después del pago, el editor se abre con el mensaje existente de esa cuenta en ese nivel, o vacío si no existe.
9. Al guardar, se crea o actualiza el mensaje y todos los saldos se muestran públicamente.

Si el pago no coincide con una solicitud pendiente, se guarda como no asociado y no publica nada hasta que una solicitud compatible lo reclame.

Cada mensaje tiene una URL permanente con su propio subranking de respuestas hasta el nivel 100. Responder cuesta también `0,02 XNO` y las respuestas se ordenan por saldo confirmado de la cuenta que responde. Si una cuenta edita un mensaje intermedio, se eliminan automáticamente los descendientes de ese mensaje y el hilo queda cortado en ese nivel.

## Recuperación Después de Reinicios

El worker revisa periódicamente `receivable` y `account_history` de la cuenta receptora. Si encuentra un bloque `receive` u `open`, resuelve su `contents.link` al bloque `send` original antes de validar. Esto cubre desconexiones WebSocket, reinicios, pagos pendientes de recibir y notificaciones duplicadas. `Payment.blockHash` es único, por lo que el mismo bloque de envío no puede publicar dos veces.

## Ranking y Saldos

Solo se consultan cuentas registradas en NanoVoices. No se recorre el ledger. El ranking principal se ordena por `cachedBalanceRaw` descendente y, en empate, por la verificación más antigua. Los subrankings de respuestas se ordenan por saldo confirmado descendente y, en empate, por la respuesta más antigua. Todos los mensajes públicos muestran saldo y la interfaz pública no muestra direcciones Nano.

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

Las pruebas iniciales cubren la conversión de `0,02 XNO` a raw y la validación crítica de bloques de pago.
