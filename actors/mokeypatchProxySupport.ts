/** This is a hack to make Bun use the proxy env vars far WebSockets. It normally only works for
 * fetch for some reason. */
(() => {
	const proxyUrls = [
		process.env.HTTP_PROXY,
		process.env.HTTPS_PROXY,
		process.env.http_proxy,
		process.env.https_proxy,
	].filter((x) => !!x);
	if (proxyUrls.length === 0) return;

	const proxyUrl = proxyUrls[0]!;

	class ProxiedWebSocket extends WebSocket {
		constructor(url: string | URL, options?: Record<string, unknown>) {
			super(url, { ...(options || {}), proxy: proxyUrl } as any);
		}
	}

	// Replace global WebSocket
	(globalThis as any).WebSocket = ProxiedWebSocket;
	console.log(
		`🔌 Found proxy env vars, overriding WebSocket with subclass with proxy option.`,
	);
})();
