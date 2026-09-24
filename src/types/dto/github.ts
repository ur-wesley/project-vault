export type GitHubDeviceStartDto = {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  intervalSec: number;
  expiresIn: number;
};

export type GitHubDeviceWaitPayload = {
  deviceCode: string;
  intervalSec: number;
  expiresIn: number;
};

export type GitHubDeviceWaitDto = {
  deviceCode: string;
  intervalSec: number;
  expiresIn: number;
};

export type GitHubDeviceTokenDto = {
  accessToken: string;
};

