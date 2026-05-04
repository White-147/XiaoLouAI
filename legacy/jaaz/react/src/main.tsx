import { SocketProvider } from '@/contexts/socket'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PostHogProvider } from 'posthog-js/react'
import '@/lib/embedded-api-prefix'
import '@/assets/style/index.css'

const options = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
}

const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={options}>
        <SocketProvider>
          <App />
        </SocketProvider>
      </PostHogProvider>
    </StrictMode>
  )
}
