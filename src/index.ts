import express from "express";
import * as Docker from "dockerode";

const docker = new Docker({socketPath: "/var/run/docker.sock"});
const app = express();
const port = process.env.LISTEN_PORT;

const FOUNDRY_CONTAINER_NAME = process.env.FOUNDRY_CONTAINER_NAME;

interface Result<T> {
    statusCode: number,
    message: string,
    data: T
}

interface ErrorMessage {
    message: string
}

app.get('/status', async (req, res) => {
    // Get container Info
    const containers = await docker.listContainers({ name: FOUNDRY_CONTAINER_NAME });
    
    let out = {};
    if(containers && containers.length > 0) {
        const data = containers[0];
        out = {
            data : {
                state : data.State,
                name : data.Names[0],
            },
            message: "ok",
            statusCode: 200
        }
    }
    else {
        out = {
            statusCode: 404,
            message: "Error or Foundry Server not found."
        }
    }    

    return res.json(out);
});

app.get('/restart', async (req, res) => {
    const containers = await docker.listContainers({ name: FOUNDRY_CONTAINER_NAME });

    let out = {
        statusCode: 0,
        message: ""
    };
    if(containers && containers.length > 0) {
        const foundryContainer = await docker.getContainer(containers[0].Id);
        const response = await foundryContainer.restart();
        
        if(response.statusCode === 204) {
            out = {
                statusCode: 204,
                message: "ok"
            }
        }
        else {
            out = {
                statusCode: response.statusCode,
                message: response.message
            }
        }
    }
    else {
        out = {
            statusCode: 404,
            message: "Could not find Foundry Server for restart"
        }
    }

    return res.status(out.statusCode).json(out);
});

app.get('/logs', async (req, res) => {
    const containers = await docker.listContainers({ name: FOUNDRY_CONTAINER_NAME });

    if(containers && containers.length > 0) {
        const foundry = await docker.getContainer(containers[0].Id);
        foundry.logs({}, (err, stream) => {
            stream?.on('data', (chunk) => {
                res.write(chunk);
            });
            stream?.on('close', () => {
                res.end();
            });
            stream?.on('error', () => {
                res.end();
            });
        });
    }
    else {
        return res.status(404).json({
            statusCode: 404,
            message: "Could not find Foundry Server for logs"
        });
    }
})

app.listen(port, () => {
    console.log(`Foundry Dashboard API listening on port ${port}`)
})