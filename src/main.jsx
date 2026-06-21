import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// No StrictMode: its dev-only double-invoke of renders/effects double-fired our
// effects (activity logging, etc.). Prod builds never double-invoke regardless.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)

// Offline support: cache the app shell so it runs without the local server.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
