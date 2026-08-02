# AI Chat App

Aplicación web de chat con IA en modo oscuro. Compatible con cualquier servidor OpenAI-compatible API (OpenAI, Ollama, LM Studio, etc.).

## Características

- 🌙 **Modo oscuro** por defecto
- 💬 **Memoria completa**: envía el system prompt + toda la conversación como contexto a cada petición
- ⚙️ **Configuración flexible**: servidor API, clave, modelo y system prompt personalizables
- 💾 **Persistencia local**: SQLite para almacenar chats y configuración
- 🔌 **Compatible con OpenAI**: funciona con OpenAI, Ollama, LM Studio, o cualquier endpoint compatible

## Estructura

```
ai-chat-app/
├── backend/          # Servidor Node.js + Express + SQLite (sql.js)
│   ├── server.js     # API REST endpoints
│   ├── db.js         # Inicialización de base de datos
│   └── data/         # Base de datos SQLite (auto-creada)
├── frontend/         # React + Vite (modo oscuro)
│   ├── src/
│   │   ├── App.jsx           # Layout principal
│   │   ├── api.js            # Client HTTP para la API backend
│   │   ├── index.css         # Estilos modo oscuro
│   │   └── components/
│   │       ├── ChatList.jsx      # Sidebar con lista de chats
│   │       ├── ChatView.jsx      # Vista del chat actual + input
│   │       └── SettingsModal.jsx # Modal de configuración
├── package.json      # Scripts para arrancar todo
```

## Instalación y uso

### 1. Instalar dependencias

```bash
npm run install:all
```

O instalar por separado:

```bash
cd backend && npm install
cd frontend && npm install
```

### 2. Arrancar la aplicación

**Opción A — Scripts del proyecto:**

```bash
# Terminal 1: Backend (puerto 3001)
npm run dev:backend

# Terminal 2: Frontend (puerto 5173)
npm run dev:frontend
```

**Opción B — Manual:**

```bash
cd backend && node server.js     # Puerto 3001
cd frontend && npx vite           # Puerto 5173
```

### 3. Configurar la IA

1. Abre http://localhost:5173
2. Haz clic en **⚙️ Settings** (esquina inferior izquierda)
3. Configura:
   - **API Base URL**: URL del servidor OpenAI-compatible
     - OpenAI: `https://api.openai.com/v1`
     - Ollama: `http://localhost:11434/v1`
     - LM Studio: `http://localhost:1234/v1`
   - **API Key**: Tu clave de API (puede estar vacía para servidores locales como Ollama)
   - **Model**: Nombre del modelo (`gpt-4o-mini`, `llama3.2`, etc.)
   - **System Prompt**: Instrucciones del sistema que se envían con cada petición

### 4. Empezar a chatear

1. Haz clic en **+ New Chat** para crear un chat nuevo
2. Escribe tu mensaje y pulsa Enter (o Shift+Enter para nueva línea)
3. El título del chat se genera automáticamente a partir del primer mensaje
4. Puedes renombrar el chat haciendo doble clic sobre el título

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/settings` | Obtener configuración actual |
| PUT | `/api/settings` | Guardar configuración |
| GET | `/api/chats` | Lista de chats |
| POST | `/api/chats` | Crear chat nuevo |
| PUT | `/api/chats/:id` | Renombrar chat |
| DELETE | `/api/chats/:id` | Eliminar chat y sus mensajes |
| GET | `/api/chats/:id/messages` | Obtener mensajes de un chat |
| POST | `/api/chats/:id/messages` | Enviar mensaje (con memoria completa) |

## Cómo funciona la "memoria"

Cada vez que envías un mensaje:

1. Se guarda tu mensaje en la base de datos
2. El backend recupera el **system prompt** + **toda la conversación** del chat
3. Envía todo el contexto al endpoint de la IA como array de mensajes
4. La respuesta se guarda y se muestra en el frontend

Esto significa que la IA tiene acceso completo a toda tu conversación previa, proporcionando una experiencia de chat con memoria perfecta.
