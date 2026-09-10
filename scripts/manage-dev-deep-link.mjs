import { fileURLToPath } from 'node:url';
import { updateDevDeepLinkProtocol } from './dev-deep-link-protocol.mjs';
import { resolveDevelopmentElectronExecutable } from './windows-development-executable.mjs';

const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const electronExecutable = await resolveDevelopmentElectronExecutable(applicationRoot);
process.exitCode = updateDevDeepLinkProtocol(process.argv[2], electronExecutable);
