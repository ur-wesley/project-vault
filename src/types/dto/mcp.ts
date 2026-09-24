export type McpServerStatusDto = {
  running: boolean;
  port: number;
  authEnabled: boolean;
  authToken: string;
  url: string;
  directUrl: string;
};

