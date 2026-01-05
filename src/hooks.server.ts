import type { Handle } from '@sveltejs/kit';

const securityHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'same-origin'
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name.toLowerCase() === 'content-type';
		}
	});

	for (const [key, value] of Object.entries(securityHeaders)) {
		response.headers.set(key, value);
	}

	return response;
};
