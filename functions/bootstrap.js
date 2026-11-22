module.exports = {
  ...require("./index"),
  ...require("./authorizationFunctions"),
  ...require("./liveMeeting"),
  ...require("./meetingGateway"),
  ...require("./meetingRecords"),
  ...require("./meetingAttendanceRegister"),
  ...require("./systemControl")
};

