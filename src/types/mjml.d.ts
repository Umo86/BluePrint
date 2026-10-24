declare module 'mjml' {
  type MjmlError = { message: string; line: number; tagName: string; formattedMessage: string };
  type MjmlOptions = { validationLevel?: 'strict' | 'soft' | 'skip'; keepComments?: boolean; minify?: boolean };
  /** MJML 5 renders asynchronously. */
  export default function mjml2html(input: string, options?: MjmlOptions): Promise<{ html: string; errors: MjmlError[] }>;
}
