/**
 * How this product writes a model provider's name for a person to read. Provider ids are
 * database values (`model_config.provider`, `byo_key.provider`); the names are proper nouns
 * and stay out of the i18n catalogue, which is why this is a module rather than a message.
 *
 * Shared because guardrail 5 sentences name the provider in more than one place now
 * (`/settings/keys`, and issue #290's keep control and kept-answer history), and the same
 * company reading the same content should not be "OpenAI" on one surface and "openai" on the
 * next. An unknown id falls through unchanged rather than being hidden: a provider nobody has
 * written a name for is still the honest answer to "who saw this".
 */
const PROVIDER_LABEL: Record<string, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Google',
	groq: 'Groq',
	mistral: 'Mistral'
};

export function providerLabel(provider: string): string {
	return PROVIDER_LABEL[provider] ?? provider;
}
