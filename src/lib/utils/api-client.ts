import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { get } from 'svelte/store';
import { authStore } from '../stores/auth';
import { browser } from '$app/environment';

// Определяем API URL динамически на основе текущего хоста
function getApiBaseUrl(): string {
	// Если указана переменная окружения, используем её
	if (import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim() !== '') {
		const url = import.meta.env.VITE_API_BASE_URL;
		if (browser) {
			console.log('[API Client] Using VITE_API_BASE_URL from env:', url);
		}
		return url;
	}
	
	// В браузере определяем URL на основе текущего хоста
	if (browser) {
		const protocol = window.location.protocol;
		const hostname = window.location.hostname;
		let url: string;
		
		// Если это localhost или 127.0.0.1, используем localhost:8080
		if (hostname === 'localhost' || hostname === '127.0.0.1') {
			url = 'http://localhost:8080/api/v1';
		} else {
			// Для production: если frontend на app.oikonomia.ru, API на api.oikonomia.ru
			// Определяем домен API на основе домена frontend
			let apiHostname = hostname;
			
			// Если frontend на app.*, API должен быть на api.*
			if (hostname.startsWith('app.')) {
				apiHostname = hostname.replace('app.', 'api.');
			} else if (hostname.startsWith('www.')) {
				// Если frontend на www.*, API должен быть на api.*
				apiHostname = hostname.replace('www.', 'api.');
			} else if (!hostname.includes('api.')) {
				// Если домен не содержит 'api.', добавляем префикс api.
				// Например: oikonomia.ru -> api.oikonomia.ru
				const parts = hostname.split('.');
				if (parts.length >= 2) {
					apiHostname = 'api.' + parts.slice(-2).join('.');
				}
			}
			
			// Используем тот же протокол (http или https) и порт 443 для HTTPS, 80 для HTTP
			// Но в production обычно API на отдельном поддомене без указания порта
			if (protocol === 'https:') {
				// HTTPS: используем стандартный порт 443 (не указываем порт)
				url = `${protocol}//${apiHostname}/api/v1`;
			} else {
				// HTTP: используем порт 8080 для development
				url = `${protocol}//${apiHostname}:8080/api/v1`;
			}
		}
		
		console.log('[API Client] Dynamic API URL determined:', url, '(from hostname:', hostname, ', protocol:', protocol, ')');
		return url;
	}
	
	// Fallback для SSR
	return 'http://localhost:8080/api/v1';
}

const API_BASE_URL = getApiBaseUrl();

if (browser) {
	console.log('[API Client] Initialized with API_BASE_URL:', API_BASE_URL);
}

// Создаем axios instance
export const apiClient: AxiosInstance = axios.create({
	baseURL: API_BASE_URL,
	headers: {
		'Content-Type': 'application/json'
	},
	withCredentials: true // Для HttpOnly cookies (refresh_token)
});

// Request interceptor - добавляем access_token в заголовки
apiClient.interceptors.request.use(
	(config) => {
		const auth = get(authStore);
		if (auth.accessToken) {
			config.headers.Authorization = `Bearer ${auth.accessToken}`;
		}
		return config;
	},
	(error) => {
		return Promise.reject(error);
	}
);

// Response interceptor - обрабатываем 401 и делаем refresh
let isRefreshing = false;
let failedQueue: Array<{
	resolve: (value?: unknown) => void;
	reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
	failedQueue.forEach((prom) => {
		if (error) {
			prom.reject(error);
		} else {
			prom.resolve(token);
		}
	});
	failedQueue = [];
};

apiClient.interceptors.response.use(
	(response: AxiosResponse) => response,
	async (error) => {
		// Если это network error (нет response), сразу возвращаем ошибку
		if (!error.response && error.request) {
			// Network error - сервер недоступен или CORS блокирует
			return Promise.reject(error);
		}

		const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

		// Если получили 401 и это не был refresh запрос и не логин
		if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes('/auth/login')) {
			// Проверяем, есть ли refresh_token перед попыткой обновления
			const auth = get(authStore);
			if (!auth.refreshToken) {
				// Если нет refresh_token, просто возвращаем ошибку (возможно, это первый запрос после логина)
				return Promise.reject(error);
			}

			if (isRefreshing) {
				// Если уже идет refresh, добавляем запрос в очередь
				return new Promise((resolve, reject) => {
					failedQueue.push({ resolve, reject });
				})
					.then((token) => {
						if (originalRequest.headers) {
							originalRequest.headers.Authorization = `Bearer ${token}`;
						}
						return apiClient(originalRequest);
					})
					.catch((err) => {
						return Promise.reject(err);
					});
			}

			originalRequest._retry = true;
			isRefreshing = true;

			try {
				// Пытаемся обновить токен (refresh_token уже проверен выше)

				const response = await axios.post(
					`${API_BASE_URL}/auth/refresh`,
					{ refresh_token: auth.refreshToken },
					{ withCredentials: true }
				);

				const { access_token, refresh_token } = response.data;
				authStore.update((state) => ({
					...state,
					accessToken: access_token,
					refreshToken: refresh_token || state.refreshToken
				}));

				// Обновляем заголовок и повторяем запрос
				if (originalRequest.headers) {
					originalRequest.headers.Authorization = `Bearer ${access_token}`;
				}

				processQueue(null, access_token);
				isRefreshing = false;

				return apiClient(originalRequest);
			} catch (refreshError) {
				processQueue(refreshError as Error, null);
				isRefreshing = false;

				// Если refresh не удался, делаем logout
				authStore.logout();
				window.location.href = '/login';

				return Promise.reject(refreshError);
			}
		}

		return Promise.reject(error);
	}
);

export default apiClient;

