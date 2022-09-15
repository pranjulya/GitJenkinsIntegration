//declaring dependencies
const util = require("../util/commonUtils");
const constants = util.getConstants();
const dbUtils = require('../util/dbUtils');
const jsftp = require("jsftp");
const fs = require('fs');
let dao = {};
let uploads = {};

const ftp = new jsftp(constants.ftpConfig.connectConfig);

/*
Dao for 1.0.0
@param{reqObj} - object - request object
*/
dao.executeV100 = async (req) => {
  let auditdata = {};
  auditdata.Category = constants.auditlog.FileUpload;
  auditdata.Asset = req.query.assetSlno;
  auditdata.Username = "TestUser";
  ftp.auth(constants.ftpConfig.user, constants.ftpConfig.pass, (err) => { });
  let fileId = req.query.xfileid;
  let startByte = parseInt(req.query.xstartbyte, 10);
  let nowdate = new Date();
  let name = Math.floor(nowdate / 1000) + '__' + req.query.name;
  let fileSize = parseInt(req.query.size, 10);
  let assetslno = req.query.assetSlno;
  const dir = constants.upload.fileUploadPath + `${assetslno}`;

  if (uploads[fileId] && fileSize == uploads[fileId].bytesReceived) {
    return;
  }

  if (!fileId) {
    auditdata.Description = constants.responseCodes.fileIdNotExistDesc;
    util.audit_logger(auditdata);
    let errObj = new Error();
    errObj.code = constants.responseCodes.fileErrorCode;
    errObj.desc = constants.responseCodes.fileIdNotExistDesc;
    return errObj;
  }
  if (!uploads[fileId]) uploads[fileId] = {};

  let upload = uploads[fileId];
  let fileStream;

  if (!startByte) {
    upload.bytesReceived = 0;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    fileStream = fs.createWriteStream(dir + '/' + `${name}`, {
      flags: 'w'
    });
  } else {

    if (upload.bytesReceived != startByte) {
      auditdata.Description = constants.responseCodes.resumableFileErrorDesc;
      util.audit_logger(auditdata);
      let errObj = new Error();
      errObj.code = constants.responseCodes.fileErrorCode;
      errObj.desc = constants.responseCodes.resumableFileErrorDesc;
      return errObj;
    }

    fileStream = fs.createWriteStream(dir + '/' + `${name}`, {
      flags: 'a'
    });
  }
  req.on('data', function (data) {
    upload.bytesReceived += data.length;
  });

  req.pipe(fileStream);

  // when the request is finished, and all its data is written
  fileStream.on("close", async function () {
    let fileListArr = await listFiles();
    let isFolderExist = await checkFolder(fileListArr, assetslno);
    if (!isFolderExist.length) {
      await createDir(assetslno);
    }
    fs.readFile(dir + "/" + `${name}`, function (err, buffer) {
      if (err) {
        callback(err);
      } else {
        ftp.put(buffer, `./ftp_dir/${assetslno}/${name}`, (err) => { });
      }
    });
    if (upload.bytesReceived == fileSize) {
      delete uploads[fileId];

      auditdata.Description = "File uploaded successfully";
      util.audit_logger(auditdata);
      // can do something else with the uploaded file here
      return ({ 'status': 'uploaded' });
    } else {
      auditdata.Description = constants.responseCodes.fileServerErrorDesc;
      util.audit_logger(auditdata);
      let errObj = new Error();
      errObj.code = constants.responseCodes.fileErrorCode;
      errObj.desc = constants.responseCodes.fileServerErrorDesc;
      return errObj;
    }
  });

  // in case of I/O error - finish the request
  fileStream.on('error', function (err) {
    auditdata.Description = constants.responseCodes.fileErrorDesc;
    util.audit_logger(auditdata);
    let errObj = new Error();
    errObj.code = constants.responseCodes.fileErrorCode;
    errObj.desc = constants.responseCodes.fileErrorDesc;
    return errObj;
  });

  return ({ 'status': constants.responseCodes.fileSuccessDesc })

}

dao.executeV110 = async (req) => {
  let fileId = req.requestPayloadData.xfileid;
  let name = req.requestPayloadData.name;
  let fileSize = parseInt(req.requestPayloadData.size, 10);
  let assetSlno = req.requestPayloadData.assetSlno;
  uploads = {};
  if (name) {
    try {
      let stats = fs.statSync(constants.upload.fileUploadPath + assetSlno + '/' + name);
      if (stats.isFile()) {
        if (fileSize == stats.size) {

          return { status: "file is present", uploaded: stats.size };
        }
        if (!uploads[fileId]) uploads[fileId] = {};
        uploads[fileId]["bytesReceived"] = stats.size;
      }
    } catch (er) { }
  }
  let upload = uploads[fileId];
  if (upload) {
    return { uploaded: upload.bytesReceived };
  } else {
    return { uploaded: 0 };
  }
};

/*
function to return list of files and directory inside the root directory
@response{res} - Object - List of files and folders with their properties
*/
async function listFiles() {
  return new Promise((resolve, reject) => {
    ftp.ls(constants.ftpConfig.ftpBaseDir, (err, res) => {
      if (err) {
        reject(err)
      } else {
        resolve(res)
      }
    });
  });
}

/*
function to check if the folder already exist or not. If it exists, then it will add it and return in the array.
@param{arr} - Object - JSON array of list of folders and files in the FTP server
@param{folderName} - String - Name of the folder which we need to check if it exists or not.
@response{res} - Object - Array of objects for which folder exist in ftp
*/
async function checkFolder(arr, folderName) {
  let temp = arr.filter(ele => {
    return ele.name == folderName;
  })
  return temp;
}

/*
function to create folder if it does not exist.
@param{folderName} - String - Name of the folder needs to be created
@response{true} - Boolean - Returns true if the folder is created.
*/
let createDir = async (folderName) => {
  return new Promise((resolve, reject) => {
    ftp.raw("mkd", `${constants.ftpConfig.ftpBaseDir}/${folderName}`, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(true)
      }
    });
  })
}

module.exports = dao;