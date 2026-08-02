# Despliegue en VPS con Docker + Coolify

Esta guía explica cómo desplegar la aplicación AI Chat en un servidor VPS usando [Coolify](https://coolify.io), una plataforma de despliegue auto-hospedada alternativa a Heroku/Railway.

## Requisitos previos

- Un **VPS** con Ubuntu 20.04+ (o similar) con al menos **1 GB de RAM**
- Docker y Docker Compose instalados en el VPS
- Una cuenta de [Coolify](https://coolify.io) o Coolify instalado en tu propio servidor
- El repositorio de GitHub: `github.com/katobesto/aiPersonChat`

---

## Arquitectura

Un **único contenedor** que construye y sirve todo:

```
┌───────────────  Contenedor (puerto 3000) ───────────────┐
│                                                         │
│   Express                                                │
│   ├── /api/*       → APIs REST + SSE streaming          │
│   ├── /*           → Frontend estático (Vite build)     │
│   └── SQLite DB    → data/ai-chat.db (volumen Docker)  │
│                                                         │
└─────────────────────────────────────────────────────────┘
        ↑
    https://aiperson.javierbenzo.com
```

Express sirve tanto las APIs como el frontend estático. Coolify gestiona un solo contenedor — sin nginx intermedio, sin docker-compose, sin complicaciones.

---

## Paso 1: Instalar Coolify (si no lo tienes ya)

Si aún no tienes Coolify, instálalo en el VPS con un solo comando:

```bash
# Conéctate al VPS por SSH
ssh root@tu-servidor-ip

# Instala Coolify automáticamente
curl -fsSL https://get.coollabs.io/coolify/install.sh | bash
```

La instalación instalará Docker, Docker Compose y configurará toda la infraestructura de Coolify. Al finalizar tendrás acceso al dashboard en `https://<tu-servidor-ip>`.

---

## Paso 2: Conectar tu servidor a Coolify

1. Abre el dashboard de Coolify
2. Ve a **Servers** → **Add Server**
3. Si Coolify está instalado en el mismo servidor, usa la conexión local (localhost)
4. Si usas Coolify cloud, introduce la IP del VPS y las credenciales SSH

---

## Paso 3: Conectar tu cuenta de GitHub

1. En Coolify ve a **Settings** → **Git Providers**
2. Selecciona **GitHub** y conecta tu cuenta (o usa un token personal)
3. Asegúrate de que el repositorio `katobesto/aiPersonChat` es visible

---

## Paso 4: Crear el recurso de despliegue

1. Ve a **Projects** → crea o selecciona un proyecto
2. Haz clic en **Add Resource** → **Application**
3. Selecciona tu repositorio GitHub y la rama `main`
4. En **Build Pack**, selecciona manualmente **Dockerfile** (Coolify lo detectará automáticamente al ver el archivo `Dockerfile` en la raíz)
5. Haz clic en **Deploy**

---

## Paso 5: Configurar Container Port, variables y dominio

En la página del recurso de Coolify:

### A) General → Container Port → `3000`

Esto es **crítico**. Le dice al proxy interno (Traefik) que enrute el tráfico HTTP al puerto 3000 donde escucha Express dentro del contenedor. Sin esto, no podrás acceder a la app.

### B) Variables de entorno

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `JWT_SECRET` | Secret para firmar los tokens JWT. **Obligatorio**. | Cualquier string aleatorio largo |

Puedes generar uno con:
```bash
openssl rand -hex 32
```

### C) Dominio → `https://aiperson.javierbenzo.com`

- El dominio debe ser SOLO el FQDN, **sin puerto**: `https://aiperson.javierbenzo.com`
- Coolify enrutará automáticamente del puerto 443 al Container Port (3000) que configuraste arriba
- Configura el DNS de Cloudflare apuntando al IP de tu VPS (registro A)
- Coolify generará automáticamente un certificado SSL con Let's Encrypt

---

## Paso 6: Desplegar

Haz clic en **Deploy** y observa los logs. Los primeros despliegues tardan más porque deben construir las imágenes Docker.

Cuando termine, deberías ver algo como:
```
🚀 AI Chat Backend running on http://localhost:3000
```

---

## Datos persistentes

La base de datos SQLite (`data/ai-chat.db`) se almacena en un **volumen Docker** que persiste entre redesplesgos y actualizaciones. No perderás datos al actualizar la app.

Al iniciar por primera vez, el sistema creará automáticamente:
- Un usuario admin (usuario: `admin`, contraseña: `admin`)

---

## Redeploy / Actualizar

Cada vez que hagas push a `main` en GitHub:
- Si has activado **Auto Deploy**, Coolify reconstruirá y desplegará automáticamente
- Si no, ve a la página del recurso y haz clic en **Redeploy**

---

## Logs y monitorización

Coolify incluye un visor de logs integrado. Desde el dashboard puedes ver los logs en tiempo real del servicio `app`.

El endpoint `/health` responde con JSON indicando si el servidor está operativo:
```bash
curl https://aiperson.javierbenzo.com/health
# {"status":"ok","uptime":1234}
```

---

## Troubleshooting

### La página no carga / pantalla en blanco / error 502
- **Container Port**: Es el paso más importante. Asegúrate de que está configurado como `3000` en General → Container Port. Sin esto, Traefik no sabrá dónde enrutar el tráfico y la app no será accesible desde fuera.
- **Dominio sin puerto**: El dominio debe ser solo `https://aiperson.javierbenzo.com`, NO `http://aiperson.javierbenzo.com:3000`
- **Logs del contenedor**: Revisa los logs en Coolify para ver si hay errores al arrancar (ej: archivos faltantes, variables sin configurar)

### Error de JWT_SECRET
Asegúrate de haber configurado la variable `JWT_SECRET` antes de desplegar. Es obligatoria.

### SSL no funciona
Coolify configura automáticamente Let's Encrypt. Asegúrate de que el DNS apunta correctamente a tu servidor antes de activar SSL.

---

## Comandos útiles

```bash
# Acceder al shell del contenedor para debug:
docker exec -it <container-id> sh

# Reiniciar el servicio desde Coolify UI o manualmente:
docker restart <container-id>

# Ver logs del contenedor:
docker logs -f <container-id>
```
