const express = require("express");
const msal = require('@azure/msal-node');
const https = require('https')
const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')
dotenv.config()
const jwt = require('jsonwebtoken')
const cors = require('cors')

const config = {
    auth: {
        clientId: process.env.CLIENTID,
        authority: process.env.AUTHORITY,
        clientSecret: process.env.CLIENTSECRET
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message, containsPii) {
//                 console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: msal.LogLevel.Verbose,
        }
    }
};

const pca = new msal.ConfidentialClientApplication(config);
const msalTokenCache = pca.getTokenCache();

const SERVER_PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.REDIRECT_URI;


const allowlist = ['https://process-builder-a3e10.web.app/', 'http://localhost:3000'];

    const corsOptionsDelegate = (req, callback) => {
    let corsOptions;

    let isDomainAllowed = whitelist.indexOf(req.header('Origin')) !== -1;
    let isExtensionAllowed = req.path.endsWith('.jpg');

    if (isDomainAllowed && isExtensionAllowed) {
        // Enable CORS for this request
        corsOptions = { origin: true }
    } else {
        // Disable CORS for this request
        corsOptions = { origin: false }
    }
    callback(null, corsOptions)
}

const app = express();
app.use(cors());


app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')
// app.use('/', (req, res) => {
//     console.log();
//     res.send('ok')
// })


// Create Express App and Routes

app.get('/login', (req, res) => {
    const authCodeUrlParameters = {
        scopes: ['profile', 'offline_access', 'api://14bfdc04-ad85-46ff-b777-65e617babfb3/User.Read'],
        redirectUri: REDIRECT_URI,
    };

    pca.getAuthCodeUrl(authCodeUrlParameters).then((response) => {
        res.redirect(response);
    }).catch((error) => console.log(JSON.stringify(error)));
});

app.get('/redirect', (req, res) => {
    const tokenRequest = {
        code: req.query.code,
        redirectUri: REDIRECT_URI,
    };
    let aud;
    const date = new Date()
    const secondsSinceEpoch = Math.round(date.getTime() / 1000)
    const test = Math.floor(Math.random() * 1000000000000)

    //console.log('secondsSinceEpoch', secondsSinceEpoch)

    pca.acquireTokenByCode(tokenRequest).then((response) => {
        oid = response.idTokenClaims.oid
        sub = response.idTokenClaims.sub
        tid = response.idTokenClaims.tid
        uti = response.idTokenClaims.uti
        //console.log('aud', aud)

        msalTokenCache.getAllAccounts().then(accounts => {
            console.log(accounts.length, 'number of active accounts')
            accounts.map(account => console.log(account))
        })

        const refreshToken = jwt.sign({oid, sub, tid, uti}, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '86400s' })
        res.statusCode = 302;
        res.setHeader("Location", `https://localhost:3000/index/1/${refreshToken}`);
        // res.setHeader("Location", `https://process-builder-a3e10.web.app/#/success?authToken=${response.accessToken}&aud=${aud}&refreshToken=${refreshToken}`);
        res.send()
        res.end();
    }).catch((error) => {
        console.log(error);
        res.status(500).send(error);
    });
});

// app.get('/index/:accessToken/:refreshToken', (req,res)=> {
//     res.render('index')
// })

app.get('/get-new-access-token', (req, res) => {
    // console.log(req.connection.remoteAddress);
    if(req.headers.authorization){
        const refreshToken = req.headers.authorization.split(' ')[1]
        jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err1, user) => {
            if(err1)    {
                console.log('error in validating');
                res.status(401).json({message: "refresh token is invalid!"})
            }
            let selectedFlag = false

            //console.log(user, '-------------------------------------');
            console.log('new access token')
            msalTokenCache.getAllAccounts().then(accounts => {
                accounts.forEach(account => {
                    console.log(account)
                    console.log(user);
                    if(user.oid === account.idTokenClaims.oid && user.sub === account.idTokenClaims.sub && user.tid === account.idTokenClaims.tid && user.uti === account.idTokenClaims.uti){
                        selectedFlag = true
        
                        const silentRequest = {
                            account, // Index must match the account that is trying to acquire token silently
                            scopes: ['profile', 'offline_access', 'api://14bfdc04-ad85-46ff-b777-65e617babfb3/User.Read'],
                        };
                    
                        pca.acquireTokenSilent(silentRequest).then((tokenCache) => {
                            res.status(200).json({accessToken: tokenCache.accessToken});
                        }).catch((error) => {
                            console.log(error)
                            console.log('in error');
                        });
                    }
                })
                if(!selectedFlag){
                    res.status(401).json()
                }
            })
        });
        
    }else{
        res.status(401).json()
    }
})

const logoutFromMsalTokenCache = (msalTokenCache, user) => {
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
        //console.log(refreshToken)
        let selectedFlag = false
        jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err1, user) => {
            if(err1)   {
                res.status(401).json({message: "refresh token is invalid!"})
            }
            // console.log(user, 'user')
            logoutFromMsalTokenCache(msalTokenCache, user).then(selectedFlag => {
                // console.log('here after call', selectedFlag)
                if(!selectedFlag){
                    res.status(401).json()
                }else{
                    res.status(200).json('logged out');
                }
            }).catch(err => {
                console.log(err, 'in err');
                res.status(401).json()
            })
        })
    }
})



const sslServer = https.createServer({
    key:fs.readFileSync(path.join(__dirname, 'cert', 'key.pem')),
    cert:fs.readFileSync(path.join(__dirname, 'cert', 'cert.pem'))
}, app)

sslServer.listen(SERVER_PORT, () => console.log(`Msal Node Auth Code Sample app listening on port ${SERVER_PORT}!`))

// const sslServer = https.createServer(app)
