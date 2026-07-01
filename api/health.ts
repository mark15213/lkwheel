export default function handler(_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }): void {
  response.status(200).json({ ok: true });
}
