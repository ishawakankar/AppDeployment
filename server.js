const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const { Observable, zip, fromEvent, merge, concat, of, bindNodeCallback } = require('rxjs');
const { pluck, map, concatMap, tap } = require('rxjs/operators');
const { spawn } = require('child_process');
const authRouter = require('./routes/authentication');
const passportSetup = require('./passport');
const passport = require('passport');
const port = process.env.PORT || 5000;
const sockets = require('socket.io');
const config = require('config');
const appDb = require('./db/db.apps');
const path = require('path');
var expressWinston = require('express-winston');
var winston = require('winston');
var fs = require('fs');

app.use(express.static(path.join(__dirname, './client/build')));
app.use(express.static(path.join(__dirname, './logs')));

app.use(expressWinston.logger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true
        }),
        new winston.transports.File({
            filename: 'access.log',
            level: 'info'
        })
    ]
}));

app.use(bodyParser.json());
app.use(passport.initialize());
app.use(passport.session());
app.use('/auth', authRouter);

const server = app.listen(port, () => {
    console.log("listening on port 5000 for app" + config.get('rxjs.app'));
})

const io = sockets(server);
app.post("/deploy", (req, res) => {
    let repoUrl, repo, appID;
    const requestResponseObservable = Observable.create((o) => {
        o.next({ req, res });
    });
    const request = requestResponseObservable.pipe(pluck("req"));
    const response = requestResponseObservable.pipe(pluck("res"));
    const url = request.pipe(pluck("body"), pluck("url"),
        tap((url) => console.log("url entered is ", url)));
    const repoName = url.pipe(map((url) => url.split("/").pop().toLowerCase()),
        tap((repo) => console.log("repo name is ", repo)));

    const zipped = zip(url, repoName);
    const emission = zipped.pipe(concatMap((data) => {
        const command = spawn(`./script2.sh`, [data[0], data[1]]);
        repoUrl = data[0];
        repo = data[1];
        const stdout = fromEvent(command.stdout, 'data');
        const stderr = fromEvent(command.stderr, 'data');
        return merge(stdout, stderr).pipe(map((data) => data.toString('utf-8')));
    }));

    const logs = emission.pipe(tap(x => {
        fs.stat("logs", (err, stats) => {
            if (err) {
                fs.mkdir("logs", (err) => {
                    console.error("error occured while creating directory", err);
                })
            }
            let data = `[  ${new Date()} ]:- ${x}`
            fs.writeFile(`logs/${repo}.log`, data, { flag: 'a' }, (err) => {
                if (err) throw err;
                console.log('The file has been saved!');
            })
        })
    }))


    const databaseEntry = logs.pipe(tap((x) => {
        appID = x.split(" ")[x.split(" ").length - 1]
        if (String(x).includes("Successfully built")) {
            storeData(repoUrl, repo, appID, "true");
        } else {
            storeData(repoUrl, repo, -1, "false");
        }
    }))

    databaseEntry.subscribe(
        x => {
            console.log('data', x);

            io.emit('chat', x);
        },
        e => {
            console.error("error object", e);
        },
        () => console.log("completed")
    )
})

app.get("/apps", (req, res) => {
    appDb.getUserApps()
        .then((data) => {
            res.json(data);
        })
        .catch((err) => console.log(err));
    
})

app.get("/profile", (req, res) => {
    var testdata = passportSetup()._json;
    if(Object.keys(testdata).length === 0) {
        console.log('null')
    }
    res.json(testdata);
})

app.get("/logout", (req, res) => {
    res.redirect('/');
})

app.get("/downloadLog/:name", (req, res) => {
  console.log(req.params.name);
  res.send("file is being downloaded")
})

app.use(expressWinston.errorLogger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true
        }),
        new winston.transports.File({
            filename: 'access.log',
            level: 'error'
        })
    ]
}));

function storeData(url, appName, appId, status) {
    appDb.addApp({
        appId: appId,
        userId: "admin",
        app_name: appName,
        timestamp: new Date(),
        status: status,
        app_URL: url
    });
}


module.exports.app= app;