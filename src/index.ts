import express from 'express'
import {LogLevel, ConfidentialClientApplication, OnBehalfOfRequest, AuthorizationCodeRequest, RefreshTokenRequest, ClientCredentialRequest} from "@azure/msal-node";
import https from 'https'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config()
import jwt, { JwtHeader, SigningKeyCallback }  from 'jsonwebtoken'
import cors from 'cors'
// import jwksClient from "jwks-rsa";
// import { HttpRequest } from "@azure/functions";
import redis from 'redis'
import { v4 as uuidv4 } from 'uuid';


const redisClient = redis.createClient(process.env.REDIS_URL);
// redisClient.on('ready',function() {
//     console.log("Redis is ready");
// });

// redisClient.on('error',function() {
//     console.log("Error in Redis");
// });


const config = {
    auth: {
        clientId: process.env.CLIENTID,
        authority: process.env.AUTHORITY,
        clientSecret: process.env.CLIENTSECRET
    },
    system: {
        loggerOptions: {
            loggerCallback() {
//                 console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: LogLevel.Verbose,
        }
    }
};

// const getSigningKeys = (header: JwtHeader, callback: SigningKeyCallback) => {
//     const client = jwksClient({
//         jwksUri: 'https://login.microsoftonline.com/common/discovery/keys'
//     });

//     client.getSigningKey(header.kid,  (err, key: any) => {
//         callback(null, key.publicKey || key.rsaPublicKey);
//     });
//   }

// const validateToken = (req): Promise<string> => {
//     return new Promise(async (resolve, reject) => {
//         const authHeader = req;
//         if (authHeader) {
//         const token = authHeader.split(' ').pop();

//         const validationOptions = {
//             audience: `api://${process.env.CLIENTID}`
//         }

//         jwt.verify(token, getSigningKeys, validationOptions, (err, payload) => {
//             if (err) {
//                 console.log(err);

//                 reject(403);
//             return;
//             }
//             resolve(token);
//         });
//         } else {
//             reject(401);
//         }
//     });
// };


const pca = new ConfidentialClientApplication(config);
const msalTokenCache = pca.getTokenCache();

const SERVER_PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.REDIRECT_URI;

const app = express();
app.use(cors());



app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')


app.get('/test', (req, res) => {
    function fib(n) {
        if (n <= 1)
            return n;

        return fib(n-1) + fib(n-2);
    }
    const output = fib(req.query.code)
    console.log('finished');

    res.status(200).json(output +  ' Hello I have come from Staging!');
});

app.get('/login', (req, res) => {
    console.log('in login');
    const authCodeUrlParameters = {
        scopes: ['profile', 'offline_access', 'api://14bfdc04-ad85-46ff-b777-65e617babfb3/User.Read'],
        redirectUri: REDIRECT_URI,
    };

    pca.getAuthCodeUrl(authCodeUrlParameters).then((response) => {
        res.redirect(response);
    }).catch((error) => console.log(JSON.stringify(error)));
});

app.get('/redirect', (req, res) => {
    console.log('in redirect');
    const tokenRequest: AuthorizationCodeRequest = {
        code: req.query.code as any,
        redirectUri: REDIRECT_URI,
        scopes: ['profile', 'offline_access', 'api://14bfdc04-ad85-46ff-b777-65e617babfb3/User.Read']
    };
    const date = new Date()
    const secondsSinceEpoch = Math.round(date.getTime() / 1000)

    console.log('secondsSinceEpoch', secondsSinceEpoch)

    pca.acquireTokenByCode(tokenRequest).then((response) => {
        const refreshToken = uuidv4()
        const saveToRedis = {
            accessToken: response.accessToken
        };
        redisClient.set(refreshToken, JSON.stringify(saveToRedis), (err,obj) =>{
            if(obj === "OK"){
                redisClient.expire(refreshToken, 1000*60*30*12);
            }
            else{
                return res.status(500).json('there is an error with creating redis object');
            }
        });
        res.statusCode = 302;
        // res.setHeader("Location", `https://localhost:3000/index/${refreshToken}`);
        res.setHeader("Location", `https://process-builder-a3e10.web.app/#/success?authToken=${response.accessToken}&refreshToken=${refreshToken}`);
        res.send()
        res.end();
    }).catch((error) => {
        console.log(error);
        res.status(500).send(error);
    });
});

app.get('/index/:accessToken', (req,res)=> {
    console.log('in index');
    res.render('index')
})


app.get('/get-new-access-token', (req, res) => {
    console.log('in get new access token');

    msalTokenCache.getAllAccounts().then(accounts => {
        console.log(accounts.length, 'number of active accounts')
        // accounts.map(account => console.log(account))
    })
    if(req.headers.authorization){
        const refreshToken = req.headers.authorization.split(' ')[1]
        redisClient.get(refreshToken, async (err, obj)=>{
            if(err){
                console.log(err);
                res.status(500).json('something went wrong with getting from redis')
            }
            if(obj === null){
                res.status(401).json();
            }
            else{
                const clientCredentialRequest: ClientCredentialRequest = {
                    // oboAssertion: acessToken as string,
                    scopes: ['api://14bfdc04-ad85-46ff-b777-65e617babfb3/.default'],
                    authority:'https://login.microsoftonline.com/80c2db9d-b609-428c-af20-edc57b847e04',
                }
                const cca = new ConfidentialClientApplication(config);
                const resp = await cca.acquireTokenByClientCredential(clientCredentialRequest)
                res.status(200).json(resp.accessToken)
            }
        })
    }else{
        res.status(401).json('UnAuthenticated');
    }
})

const logoutFromMsalTokenCache = (msalTokenCache, user)=>{
    let selectedFlag = false
    return new Promise((resolve, reject) => {
        msalTokenCache.getAllAccounts().then(accounts => {
            accounts.forEach(account => {
                if(user.oid === account.idTokenClaims.oid && user.sub === account.idTokenClaims.sub && user.tid === account.idTokenClaims.tid && user.uti === account.idTokenClaims.uti){
                    selectedFlag = true
                    console.log(selectedFlag)
                    msalTokenCache.removeAccount(account)
                    msalTokenCache.getAllAccounts().then(accounts => {
                        console.log(accounts.length, 'number of active accounts')
                    })
                }else{
                    console.log('not found');
                }
            })
            resolve(selectedFlag)
        })
    })
}

app.get('/logout', (req, res) => {
    if(req.headers.authorization){

        const refreshToken = req.headers.authorization.split(' ')[1]
        console.log(refreshToken)
        const selectedFlag = false
        redisClient.del(refreshToken)
        res.status(200).json('logged out!!')
    }
})


// const sslServer = https.createServer({
// key:fs.readFileSync(path.join(__dirname, 'cert', 'key.pem')),
// cert:fs.readFileSync(path.join(__dirname, 'cert', 'cert.pem'))
// }, app)

// sslServer.listen(SERVER_PORT, () => console.log(`Msal Node Auth Code Sample app listening on port ${SERVER_PORT}!`))



app.listen(SERVER_PORT, () => {
    console.log('connected to 3000, new change')
})



const onBehalfOfRequest = async (req,res) => {
    const config = {
        auth: {
            clientId: process.env.CLIENTID,
            authority: process.env.AUTHORITY,
            clientSecret: process.env.CLIENTSECRET
        }
    };
    if(req.headers.authorization){
        const acessToken = req.headers.authorization.split(' ')[1]
        const oboRequest: OnBehalfOfRequest = {
            oboAssertion: acessToken as string,
            scopes: ["user.read"],
        }
        try{
            const cca = new ConfidentialClientApplication(config);
            const response = await cca.acquireTokenOnBehalfOf(oboRequest);
            res.status(200).json(response.accessToken)
        }catch(err){
            console.log(err);
        }
        // });

    }else{
        res.status(401).json()
    }
}
