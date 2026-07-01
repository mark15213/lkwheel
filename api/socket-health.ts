export default function handler(request: { url?: string }, response: { status: (code: number) => { json: (body: unknown) => void } }): void {
  response.status(200).json({
    ok: true,
    url: request.url,
    socketPath: "/api/socket-io",
    compatiblePaths: ["/api/socket-io", "/api/socket-io/socket.io", "/socket.io"]
  });
}
