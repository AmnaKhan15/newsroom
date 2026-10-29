import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { EmbedView, readEmbed } from './data/embed.jsx'
import './styles.css'

// A link with #embed=… renders only the chart, for use inside an article iframe
const spec = readEmbed()
createRoot(document.getElementById('root')).render(spec ? <EmbedView spec={spec} /> : <App />)
