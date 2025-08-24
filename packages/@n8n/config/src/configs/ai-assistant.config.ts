import { Config, Env } from '../decorators';

@Config
export class AiAssistantConfig {
	/** Base URL of the AI assistant service */
	@Env('N8N_AI_ASSISTANT_BASE_URL')
	baseUrl: string = '';

	/** API key for the AI assistant service */
	@Env('N8N_AI_ASSISTANT_API_KEY')
	apiKey: string = '';

	/** Model to use for AI assistant requests */
	@Env('N8N_AI_MODEL')
	model: string = '';
}
