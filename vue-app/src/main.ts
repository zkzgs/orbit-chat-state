import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { imageSource } from './composables/imageSource'
import './styles/main.css'
import './styles/workspace.css'
createApp(App)
  .use(createPinia())
  .directive('image-source', imageSource)
  .mount('#app')

import './styles/theme.css'

import './styles/chat.css'
