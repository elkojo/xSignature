import { mount } from 'svelte';

import App from './App.svelte';
import './app.css';
import './signature.css';
import './document.css';

export default mount(App, { target: document.getElementById('app')! });
