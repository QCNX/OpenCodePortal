function shellQuote(value: unknown): string {
  const raw = String(value ?? '');
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(raw)) return raw;
  return `'${raw.replace(/'/g, `'\\''`)}'`;
}

function dotenvValue(value: unknown): string {
  const raw = String(value ?? '');
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(raw)) return raw;
  return JSON.stringify(raw).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export interface DeployInstructionsInput {
  instanceId: string;
  name: string;
  token: string;
  baseDomain: string;
  agentImage: string;
  targetHost: string;
  targetPort: number;
}

export interface DeployInstructions {
  instanceId: string;
  name: string;
  assignedToken: string;
  gatewayUrl: string;
  dockerRun: string;
  dockerUpgrade: string;
  composeFile: string;
  composeEnv: string;
  composeUpgrade: string;
}

export function buildDeployInstructions(input: DeployInstructionsInput): DeployInstructions {
  const img = input.agentImage;
  // GATEWAY_URL default uses wss:// since TLS is handled by NPM.
  const gwUrl = `wss://${input.baseDomain}/agent/connect`;
  const gwUrlDefault = `wss://${input.baseDomain}/agent/connect`;

  const envVars: [string, string | number][] = [
    ['AGENT_REGISTRATION_TOKEN', input.token],
    ['GATEWAY_URL', gwUrl],
    ['AGENT_TARGET_HOST', input.targetHost],
    ['AGENT_TARGET_PORT', input.targetPort],
  ];

  const composeLines = [
    'services:',
    '  opencode-agent:',
    `    image: ${img}`,
    '    container_name: ocp-agent',
    '    network_mode: host',
    '    restart: unless-stopped',
    '    environment:',
    `      AGENT_REGISTRATION_TOKEN: \${AGENT_REGISTRATION_TOKEN:?err}`,
    `      GATEWAY_URL: \${GATEWAY_URL:-${gwUrlDefault}}`,
    `      AGENT_TARGET_HOST: \${AGENT_TARGET_HOST:-127.0.0.1}`,
    `      AGENT_TARGET_PORT: \${AGENT_TARGET_PORT:-4096}`,
  ];
  composeLines.push('    volumes:');
  composeLines.push('      - agent-data:/app/data');
  composeLines.push('volumes:');
  composeLines.push('  agent-data:');

  const containerName = `ocp-agent-${input.instanceId}`;
  const volumeName = `${containerName}-data`;
  const dockerRunEnv = envVars.map(([key, value]) => `-e ${key}=${shellQuote(value)}`).join(' \\\n  ');
  const composeEnv = envVars.map(([key, value]) => `${key}=${dotenvValue(value)}`).join('\n');
  const dockerRun = `docker run -d --name ${containerName} \\\n  --restart unless-stopped \\\n  --network host \\\n  -v ${volumeName}:/app/data \\\n  ${dockerRunEnv} \\\n  ${img}`;

  const upgradeSeparator = ' && \\' + '\n';
  const dockerUpgrade = [
    `docker pull ${img}`,
    `docker rm -f ${containerName}`,
    dockerRun,
    `docker ps --filter name=${containerName}`,
  ].join(upgradeSeparator);
  const composeUpgrade = [
    'docker compose pull opencode-agent',
    'docker compose up -d --force-recreate opencode-agent',
    'docker compose ps opencode-agent',
  ].join(upgradeSeparator);

  return {
    instanceId: input.instanceId,
    name: input.name,
    assignedToken: input.token,
    gatewayUrl: gwUrl,
    dockerRun,
    dockerUpgrade,
    composeFile: composeLines.join('\n'),
    composeEnv,
    composeUpgrade,
  };
}
