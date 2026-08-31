import { updateDevDeepLinkProtocol } from './dev-deep-link-protocol.mjs';

process.exitCode = updateDevDeepLinkProtocol(process.argv[2]);
