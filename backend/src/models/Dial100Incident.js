const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mediaSchema = new mongoose.Schema({
  url: { type: String },
  public_id: { type: String },
  resource_type: { type: String },
  format: { type: String },
  bytes: { type: Number },
  original_filename: { type: String }
}, { _id: false });

const dial100IncidentSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  date: {
    type: Date,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  slNo: {
    type: Number,
    default: 0
  },
  incidentDetails: {
    type: String,
    default: ''
  },
  incidentCategory: {
    type: String,
    default: ''
  },
  location: {
    type: String,
    default: ''
  },
  dateTime: {
    type: Date
  },
  psJurisdiction: {
    type: String,
    default: ''
  },
  zoneJurisdiction: {
    type: String,
    default: ''
  },
  remarks: {
    type: String,
    default: ''
  },
  mediaFiles: {
    type: [mediaSchema],
    default: []
  },
  status: {
    type: String,
    default: 'Pending'
  },
  priority: {
    type: String,
    default: 'Normal'
  },
  callerNumber: {
    type: String,
    default: ''
  },
  assignedTo: {
    type: String,
    default: ''
  },
  createdBy: {
    type: String,
    default: 'system'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

dial100IncidentSchema.index({ date: 1, category: 1, slNo: 1 });// Two clients share this database. Reads are filtered to the logged-in
// user's vertical and new rows inherit it. See utils/verticalScope.js.
dial100IncidentSchema.plugin(require('../utils/verticalScope').verticalScopePlugin);



module.exports = mongoose.model('Dial100Incident', dial100IncidentSchema);
