

export class FacebookApiError extends Error {
    constructor(
        public message: string,
        public status: number,
        public code: number,
        public fbTraceId: string
    ) {
        super(message);
        this.name = 'FacebookApiError';
    }
}

interface GraphRequestConfig {
    params?: Record<string, string | number | boolean>;
    accessToken?: string;
}

const GRAPH_API_VERSION = 'v19.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class GraphAPIClient {

    static async get<T>(endpoint: string, config: GraphRequestConfig): Promise<T> {
        const url = this.buildUrl(endpoint, config);
        console.log(`[GraphAPI] GET ${endpoint}`);

        // In node-fetch v2 (which is typically used in CJS/TS mixes unless v3 ESM), basic fetch
        // If project uses v3, imports might differ. Assuming standard fetch is available or polyfilled.
        // socialflow package.json has "@types/node-fetch": "^2.6.13" but also "node-fetch" isn't explicitly in dependencies?
        // Wait, package.json has "node-fetch" missing in dependencies list!
        // But it has "@types/node-fetch".
        // "canvas" is there. "express" is there.
        // I need to check if fetch is globally available (Node 18+) or if I need to use `axios` or add `node-fetch`.
        // Package.json has: "type": "module". Node 20.16.11 is used in parsing.
        // Node 18+ has native fetch. I should use `global.fetch` or just `fetch`.
        // Explicit import `import fetch from 'node-fetch'` might fail if not installed.
        // I will use native fetch.

        // Remove import above if using native.

        const response = await fetch(url.toString());
        return this.handleResponse<T>(response);
    }

    static async post<T>(endpoint: string, body: any, config: GraphRequestConfig): Promise<T> {
        const url = this.buildUrl(endpoint, config);
        console.log(`[GraphAPI] POST ${endpoint}`);

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        return this.handleResponse<T>(response);
    }

    private static buildUrl(endpoint: string, config: GraphRequestConfig): URL {
        const url = new URL(`${BASE_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`);

        if (config.accessToken) {
            url.searchParams.append('access_token', config.accessToken);
        }

        if (config.params) {
            Object.entries(config.params).forEach(([key, value]) => {
                url.searchParams.append(key, String(value));
            });
        }

        return url;
    }

    private static async handleResponse<T>(response: Response): Promise<T> {
        const data: any = await response.json();

        if (!response.ok) {
            // Parse FB Error structure
            const error = data.error || {};
            throw new FacebookApiError(
                error.message || 'Unknown Facebook API Error',
                response.status,
                error.code || 0,
                error.fbtrace_id || ''
            );
        }

        return data as T;
    }
}
