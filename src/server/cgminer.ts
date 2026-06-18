import net from 'net';

export async function sendCgminerCommand(minerIp: string, port: number, command: string, parameter?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let data = '';

    const cmdObj: Record<string, unknown> = { command };
    if (parameter) cmdObj.parameter = parameter;

    client.connect(port, minerIp, () => {
      client.write(JSON.stringify(cmdObj));
    });

    client.on('data', (chunk) => {
      data += chunk;
    });

    client.on('close', () => {
      try {
        const cleanData = data.replace(/\0/g, '');
        resolve(JSON.parse(cleanData));
      } catch (error) {
        reject(error);
      }
    });

    client.on('error', (err) => {
      reject(err);
    });

    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error('Timeout'));
    });
  });
}
