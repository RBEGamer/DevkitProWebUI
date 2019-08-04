'use strict';

const { exec } = require('child_process');
var archiver = require('archiver');
var rimraf = require('rimraf');
var fs = require('fs');
var config = require('./config.json');
var currentPath = process.cwd();
var path = require('path');
var express = require('express');
var app = express();
var listEndpoints = require('express-list-endpoints');
var uuidv1 = require('uuid/v1');
var port = process.env.PORT || 3015;
var server = app.listen(port);
var { spawn } = require('child_process');

server.timeout = 1000 * 60 * 10; // 10 minutes
app.use('/static', express.static(__dirname + '/public'));
app.use(require('sanitize').middleware);


var watch = require('node-watch');


var output_file_types = config.output_file_types || [".nro", ".elf", ".nacp"];

var src_dir = config.src_dir || "./build_files/src_to_compile";
var out_dir = config.out_dir || "./build_files/output_files";
var archive_dir = config.archive_dir || "./build_files/archive_dir";
var nxlink_transfer_filetype = config.nxlink_transfer_filetype || ".nro";


var last_build_files_path = [];

var build_uuid = "none";
var last_package_uuid = "";
var is_build_running = false;
var std_out = "";
var std_err = "";
var build_ret_code = "";
var child_build_process = null;
var child_transfer_process = null;

//https://stackoverflow.com/questions/15641243/need-to-zip-an-entire-directory-using-node-js
function zipDirectory(source, out) {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(out);
    return new Promise((resolve, reject) => {
        archive.directory(source, false).on('error', err => reject(err)).pipe(stream);
        stream.on('close', () => resolve());
        archive.finalize();
    });
}


watch(path.join(currentPath, src_dir), { recursive: true, delay: 100 }, function (evt, name) {
    //react ony if build is running // TODO use watc function
    if (name == "error") {
        console.log("WATCH ERROR");
    }
    if (!is_build_running) {
        return;
    }
    //ignore remove events
    if (evt == 'remove') {
        return;
    }

    //notice file path from an build output file
    if (output_file_types.includes(path.extname(path.join(name)))) {
        if (!last_build_files_path.includes(name)) {
            last_build_files_path.push(name);
        }
    }
});


app.get('/rest/trigger_build', function (req, res) {
    if (is_build_running){
        res.json({err_text:"build_is _running",err:-1, src_dir: src_dir, out_dir: out_dir, is_build_running: is_build_running, build_uuid: build_uuid });
        return;
    }
    rimraf(path.join(currentPath, out_dir), function (err) {
        if (err) {
            res.json({ err_text: "cant clear out_dir", err: err, src_dir: src_dir, out_dir: out_dir, currentPath: currentPath });
            return;
        }

        last_build_files_path = [];
        is_build_running = true;
        build_uuid = uuidv1();
        std_err = "";
        std_out = "";
        res.json({ src_dir: src_dir, out_dir: out_dir, is_build_running: is_build_running, build_uuid: build_uuid });

        child_build_process = spawn('./run_build.sh');
        //SAVE OUTPUT
        child_build_process.stdout.on('data', (chunk) => {
            console.log(String(chunk.toString('utf8')));
            std_out += chunk.toString('utf8');
        });
        child_build_process.stderr.on('data', (chunk) => {
            console.error(String(chunk.toString('utf8')));
            std_err += chunk.toString('utf8');
        });
      

        child_build_process.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
            is_build_running = false;
            build_ret_code = code;
        });
        child_build_process.on('exit', (code) => {
            console.log(`child process exited with code ${code}`);
            is_build_running = false;
            build_ret_code = code;
        });

    });



});


app.get('/rest/get_build_state', function (req, res) {
    res.json({ last_build_files: last_build_files_path, is_build_running: is_build_running, build_uuid: build_uuid, std_err: std_err, std_out: std_out, build_return_code: build_ret_code});
});

app.get('/rest/stop_build', function (req, res) {
    if (child_build_process != undefined && child_build_process != null){
        child_build_process.kill('SIGINT');
    }
    res.json({ is_build_running: is_build_running, build_uuid: build_uuid, std_out: std_out, std_out: std_out });
});







app.get('/rest/package_last_build', function (req, res) {
    var outp = path.join(currentPath, archive_dir, String(build_uuid) + ".zip");
    //PREVENT MUTILBE PACKING
    var pack = false;
    if (last_package_uuid != build_uuid) {
        last_package_uuid = build_uuid;
        zipDirectory(path.join(currentPath, out_dir), outp);
        pack = true;
    }

    res.json({ path: outp, pack: pack });
});



var transfer_std_out = "";
var transfer_std_err ="";

var walkSyncNRO = function (dir, filelist) {
    var fs = fs || require('fs'),
        files = fs.readdirSync(dir);
    filelist = filelist || [];
    files.forEach(function (file) {
        if (fs.statSync(dir + '/' + file).isDirectory()) {
            filelist = walkSyncNRO(dir + '/' + file, filelist);
        }
        else {
            if (path.extname(file) == nxlink_transfer_filetype) {
                filelist.push(path.join(dir, file));
            }
        }
    });
    return filelist;
};


app.get('/rest/transfer_build/:switchip', function (req, res) {
    transfer_std_out = "";
    transfer_std_err = "";

    var ip = req.params.switchip;
    var last_build_nro = "";
    var child_transfer_process = null;
    //GET NRO last_build_files_path
    var nrolist = walkSyncNRO(src_dir);

    if (nrolist && nrolist.length > 0){
        last_build_nro = nrolist[0];
    }else{
        res.json({ err: -4, err_text: "no nro files found", build_uuid: build_uuid });
        return;
    }

    last_build_nro = path.join(currentPath, last_build_nro);
    var cmd = 'nxlink -r 10 -a ' + ip + ' ' + last_build_nro + '';

    try {
        child_transfer_process = spawn('nxlink', ['-r', '10', '-a', ip, last_build_nro]).on('error', function (err) { throw err });
        //SAVE OUTPUT
        child_transfer_process.stdout.on('data', (chunk) => {
            console.log(String(chunk.toString('utf8')));
            transfer_std_out += chunk.toString('utf8');
        });
        child_transfer_process.stderr.on('data', (chunk) => {
            console.error(String(chunk.toString('utf8')));
            transfer_std_err += chunk.toString('utf8');
        });



        child_transfer_process.on('exit', (code, signal) => {
            console.log(`child process exited with code ${code}`);
            res.json({ build_uuid: build_uuid, std_out: transfer_std_out, std_err: transfer_std_err, last_build_nro: last_build_nro, last_build_files_path: last_build_files_path, cmd: cmd, code: code});
        });
    } catch (error) {
        res.json({ err: -3, err_text: "cant spawn cild process nxlink", build_uuid: build_uuid, std_out: transfer_std_out, std_err: transfer_std_err, last_build_nro: last_build_nro, last_build_files_path: last_build_files_path, cmd: cmd, code: code});

    }

   

    
});
















//RETURNS A JSON WITH ONLY /rest ENPOINTS TO GENERATE A NICE HTML SITE
var REST_ENDPOINT_PATH_BEGIN_REGEX = "^\/rest\/(.)*$"; //REGEX FOR ALL /rest/* beginning
var REST_API_TITLE = "DevkitProWebUI";
var rest_endpoint_regex = new RegExp(REST_ENDPOINT_PATH_BEGIN_REGEX);
var REST_PARAM_REGEX = "\/:(.*)\/"; // FINDS /:id/ /:hallo/test
//HERE YOU CAN ADD ADDITIONAL CALL DESCTIPRION
var REST_ENDPOINTS_DESCRIPTIONS = [
    //{ endpoints: "/rest/all_events", text: "Returns all parsed calendar results" },

];

app.get('/listendpoints', function (req, res) {
    var ep = listEndpoints(app);
    var tmp = [];
    for (let index = 0; index < ep.length; index++) {
        var element = ep[index];
        if (rest_endpoint_regex.test(element.path)) {
            //LOAD OPTIONAL DESCRIPTION
            for (let descindex = 0; descindex < REST_ENDPOINTS_DESCRIPTIONS.length; descindex++) {
                if (REST_ENDPOINTS_DESCRIPTIONS[descindex].endpoints == element.path) {
                    element.desc = REST_ENDPOINTS_DESCRIPTIONS[descindex].text;
                }
            }
            //SEARCH FOR PARAMETERS
            //ONLY REST URL PARAMETERS /:id/ CAN BE PARSED
            //DO A REGEX TO THE FIRST:PARAMETER
            element.url_parameters = [];
            var arr = (String(element.path) + "/").match(REST_PARAM_REGEX);
            if (arr != null) {
                //SPLIT REST BY /
                var splittedParams = String(arr[0]).split("/");
                var cleanedParams = [];
                //CLEAN PARAEMETER BY LOOKING FOR A : -> THAT IS A PARAMETER
                for (let cpIndex = 0; cpIndex < splittedParams.length; cpIndex++) {
                    if (splittedParams[cpIndex].startsWith(':')) {
                        cleanedParams.push(splittedParams[cpIndex].replace(":", "")); //REMOVE :
                    }
                }
                //ADD CLEANED PARAMES TO THE FINAL JOSN OUTPUT
                for (let finalCPIndex = 0; finalCPIndex < cleanedParams.length; finalCPIndex++) {
                    element.url_parameters.push({ name: cleanedParams[finalCPIndex] });

                }
            }
            //ADD ENPOINT SET TO FINAL OUTPUT
            tmp.push(element);
        }
    }
    res.json({ api_name: REST_API_TITLE, endpoints: tmp });
});


app.get('/', function (req, res) {
    res.redirect('static/index.html');
});
app.get('/index.html', function (req, res) {
    res.redirect('static/index.html');
});