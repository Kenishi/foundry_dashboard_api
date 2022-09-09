import fs from "fs/promises";
import { PassThrough } from "stream";
import express, { json } from "express";
import http from "http";
import { Server } from "socket.io";
import Docker, { Container, ContainerInspectInfo, Volume } from "dockerode";
import cors from "cors";
import morgan from 'morgan';
import fetch from "node-fetch";

const FOUNDRY_API_SOCKET_URL_PATH = "/api/socket.io/";

const docker = new Docker({socketPath: "/var/run/docker.sock"});
const app = express();

const httpServer = http.createServer(app);

const CORS_HOSTNAMES = process.env.CORS_HOSTNAMES?.split(" ");
console.log("CORS HOSTNAMES:", process.env.CORS_HOSTNAMES);
const origin = CORS_HOSTNAMES || [""];
const io = new Server(httpServer, { 
    cors: {
        origin: origin,
        methods: ["GET", "POST"],
    },
    path: FOUNDRY_API_SOCKET_URL_PATH
});
const port = parseInt(process.env.LISTEN_PORT || "0");

app.use(cors());

app.use(morgan('dev'));

const api = express.Router();
app.use("/api", api);

const FOUNDRY_CACHE: string = "/foundry_cache"; // If testing outside docker, this needs changed
const FOUNDRY_COMPOSE_FILE_PATH: string = process.env.FOUNDRY_COMPOSE_FILE_PATH!;
const FOUNDRY_CONTAINER_NAME = process.env.FOUNDRY_CONTAINER_NAME;

console.log("CORS Origin (Socket.io):", origin);
console.log("Foundry name:", FOUNDRY_CONTAINER_NAME);
console.log("Foundry Compose Path:", FOUNDRY_COMPOSE_FILE_PATH);

interface Result<T> {
    statusCode: number,
    message: string,
    data: T
}

interface ErrorMessage {
    message: string
}

const CHECK_IMAGE_VERSIONS_INTERVAL_SEC = 90;
let availableImageVersions: string[] = [];

type TagItem = {
    name: string
};

interface DockerResponse {
    count: number,
    next: string,
    results: TagItem[]
}

async function fetchImageTags(): Promise<TagItem[]> {
    let response;
    let tags: TagItem[] = [];
    try {
        let j: DockerResponse;
        let nextUrl = "https://registry.hub.docker.com/v2/repositories/felddy/foundryvtt/tags?page_size=100"
        do {
            response = await fetch(nextUrl);
            j = (await response.json()) as DockerResponse;
            console.log(j.results);
            tags = j.results.length > 0 ? [...tags, ...j.results] : tags;
            nextUrl = j.next;
        } while(j.next !== null)
    } catch(e) {
        console.error(response);
        console.error(e);
        tags = [];
    }
    return tags;
}

async function checkImageVersionTags() {
    let json: TagItem[] | null = await fetchImageTags();

    // Do stupid check for updating: count, first item, last item check
    if(!json) {
        console.log("Response from Docker Hub was null")
    }
    else {
        availableImageVersions = availableImageVersions.length !== json.length ? json.map(item => item.name) : availableImageVersions;
        availableImageVersions = availableImageVersions[0] !== json[0].name ? json.map(item => item.name) : availableImageVersions;
        availableImageVersions = availableImageVersions[availableImageVersions.length-1] !== json[json.length-1].name ? json.map(item => item.name) : availableImageVersions;
    }
    setTimeout(checkImageVersionTags, CHECK_IMAGE_VERSIONS_INTERVAL_SEC * 5000);
}
checkImageVersionTags() // Start the version checking

async function getFoundryContainer() : Promise<Container | null> {
    const containers = await docker.listContainers({ all: true, filters: { name: [`${FOUNDRY_CONTAINER_NAME}`]}});

    if(containers && containers.length > 0) {
        const id = containers[0].Id;
        const foundry = await docker.getContainer(id);
        return foundry;
    }
    
    return null;
}

async function getAvailableFoundryZipVersions() : Promise<string[]> {
    const files = await fs.readdir(`${FOUNDRY_CACHE}`);

    const versions = files.map((file) => {
        const expr = /^foundryvtt-(?<version>\d.\d+).zip/gm;
        const result = expr.exec(file);
        const version = result !== null ? result.groups!.version : null;
        return version;
    })
    .filter(v => v !== null);

    return versions as string[];
}

async function getInstalledCurrentVersion(foundry: Container): Promise<string | null> {
    const inspect = await foundry.inspect();
    return inspect.Config.Labels["com.foundryvtt.version"];
}


api.get('/status', async (req, res) => {
    // Get container Info
    const foundry = await getFoundryContainer();
    let out = {};
    if(foundry) {
        // Get available foundry server file versions
        const versions = await getAvailableFoundryZipVersions();
        const matchingTagAndVersions = versions.filter(v => availableImageVersions.some(tag => tag === v));

        // Get current installed server version
        const currentVersion = await getInstalledCurrentVersion(foundry!);

        const foundry_inspect: ContainerInspectInfo = await foundry.inspect();
        out = {
            data : {
                started : foundry_inspect.State.StartedAt,
                state : foundry_inspect.State.Status,
                name : foundry_inspect.Name,
                availableZipInstalls: matchingTagAndVersions,
                currentVersion: currentVersion
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

api.get('/restart', async (req, res) => {
    const foundry = await getFoundryContainer();

    let out = {
        statusCode: 0,
        message: ""
    };
    if(foundry) {
        await foundry.restart().then((data) => {
            out = {
                statusCode: 204,
                message: "ok"
            };
            res.status(200).json(out);
        }).catch((err) => {
            out = {
                statusCode: err.statusCode,
                message: err.message
            };
            res.status(out.statusCode).json(out);
        });
    }
    else {
        out = {
            statusCode: 404,
            message: "Could not find Foundry Server for restart"
        }
        return res.status(out.statusCode).json(out);
    }    
});

api.get('/logs', async (req, res) => {
    const foundry = await getFoundryContainer();

    if(foundry) {
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
});

api.get('/update', async (req, res) => {
    // Get zip to update
    if(!req.query.version) return res.status(500).json({
        statusCode: 500,
        message: "Zip version required"
    });

    const version: string = req.query.version! as string;

    // Down Foundry Server first
    const downResult = await docker.run("docker/compose:1.25.0", ["-f", "/docker_compose.yml", "down"], process.stdout, { 
        "HostConfig": { 
            AutoRemove: true,
            Binds: [
                `${FOUNDRY_COMPOSE_FILE_PATH}:/docker_compose.yml:ro`,
                "/var/run/docker.sock:/var/run/docker.sock"
            ]
        }
    });
    
    // Begin waiting for complete downing
    let count = 0;
    const interval = setInterval(async () => {
        if(count >= 30) {
            clearInterval(interval);
            return res.status(500).json({
                statusCode: 500,
                message: "Timeout waiting for Foundry to be removed."
            });
        }
        
        const foundry = await getFoundryContainer();
        if(foundry) {
            count++;
            return;
        }
        else {
            clearInterval(interval);
            const upResult = await docker.run("docker/compose:1.25.0", ["-f", "/docker_compose.yml", "up", "-d"], process.stdout, {
                "Env": [`TAG_VERSION=${version}`],
                "HostConfig": { 
                    AutoRemove: true ,
                    Binds: [
                        `${FOUNDRY_COMPOSE_FILE_PATH}:/docker_compose.yml:ro`,
                        "/var/run/docker.sock:/var/run/docker.sock"
                    ],
                }
            });
            
            return res.status(200).json({
                statusCode: 200,
                message: "ok"
            });
        }
    }, 500);
});

// Socket IO Comms for logs

enum LogType {
    STDIN=0,
    STDOUT=1,
    STDERR=2
}

class LogEntry {
    constructor(type: LogType, message: string) {
        this.type = type;
        this.message = message;
    }
    type: LogType;
    message: string;
}

function logBufferToJSON(buffer: Buffer): LogEntry[] {
    let i = 0;
    let type: LogType = 0;
    let payload: string = "";
    let entries: LogEntry[] = [];
    while(i < buffer.length) {
        //Each loop should be 1 message
        // Read header, 8 bytes
        type = buffer.readUInt8(i); i+=1;
        i+=3; // skip reserved
        const payloadLength: number = buffer.readUInt32BE(i); i+=4;
        payload = buffer.toString("utf8", i, i+payloadLength); i+=payloadLength;
        entries.push(new LogEntry(type, payload));
    }
    return entries;
}

const LOG_TAIL_AMOUNT = 2000;
io.on("connect", (socket) => {
    socket.join("logs");
    socket.send("Begin Log Stream...\n");

    socket.on("refresh", async (data) => {
        const foundry = await getFoundryContainer();

        if(foundry) {
            const limit = data.limit !== undefined && data.limit >= 0 ? data.limit :
                data.limit < 0 ? undefined : LOG_TAIL_AMOUNT;
            foundry.logs({
                follow: false,
                stderr: true,
                stdout: true,
                tail: limit
            }, (err, data:any) => {
                const dataStr: string = data as string;
                const buffer: Buffer = Buffer.from(dataStr, 'utf8');
                if (err) {
                    console.log(err);
                    socket.emit("data", ["Log refresh: Error while establishing log stream.\n"]);
                    socket.emit("data", err.message);
                    return;
                }
                if(buffer) {
                    const entries: LogEntry[] = logBufferToJSON(buffer);
                    socket.emit("refresh", [`=====BEGIN Last ${limit} log events...\n`,  ...entries.map(e => e.message), `=====END Last ${limit} log events.\n`]);
                }
                else {
                    socket.emit("data", ["Log refresh: Error, buffer received was empty\n"]);
                }
            });
        }
    });
});

let LOG_LISTENER_CONNECT_INTERVAL: NodeJS.Timer | null = null;
const LOG_LISTENER_RETRY_IN_SEC = 5;

async function establishLogStream() {
    const foundry = await getFoundryContainer();

    if(foundry) {
        foundry.logs({
            follow: true,
            stderr: true,
            stdout: true,
            tail: 0
        }, (err, stream) => {
            if(err) {
                console.log(err);
                io.in("logs").emit("data", ["Server log reader: Error while establishing log stream.\n"]);
                io.in("logs").emit("data", [err.message]);
                return;
            }
            io.in("logs").emit("data", "Server acquired foundry log stream connection\n");
            const logStream = new PassThrough();
            foundry.modem.demuxStream(stream, logStream, logStream);

            logStream.on('data', (chunk: Buffer) => {
                io.in("logs").emit("data", chunk.toString("utf8"));
            });

            stream?.on("end", () => {
                logStream.end("Server lost connection to log stream, re-acquiring...\n");
                startLogListening();
            })

            // Clear the interval
            clearInterval(LOG_LISTENER_CONNECT_INTERVAL!);
            LOG_LISTENER_CONNECT_INTERVAL = null;
        })
    }
    else {
        io.in("logs").emit("data", [`Failed to find foundry, retrying in ${LOG_LISTENER_RETRY_IN_SEC} secs...\n`]);
    }
}

function startLogListening() {
    io.in("logs").emit("data", ["Server log reader: Establishing log stream with foundry server container...\n"]);
    LOG_LISTENER_CONNECT_INTERVAL = setInterval(establishLogStream, LOG_LISTENER_RETRY_IN_SEC*1000);
}

httpServer.listen(port, () => {
    console.log(`Foundry Dashboard API listening on port ${port}`)
    startLogListening();
})
