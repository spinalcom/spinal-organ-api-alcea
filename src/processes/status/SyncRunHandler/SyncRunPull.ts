/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

import moment = require('moment');

import {
  SpinalContext,
  SpinalGraph,
  SpinalGraphService,
  SpinalNode,
  SpinalNodeRef,
  SPINAL_RELATION_PTR_LST_TYPE,
} from 'spinal-env-viewer-graph-service';
import type OrganConfigModel from '../../../model/OrganConfigModel';
import {
  AlceaLogAccess,
  LogAccessApiResponse,
  AlceaLogAccessParsed,
  getAccessLogs,
} from '../../../services/client/accessLog';

import {
  AlceaLogAlarm,
  LogAlarmApiResponse,
  AlceaLogAlarmParsed,
  getAlarmLogs,
} from '../../../services/client/alarmLog';
import { attributeService } from 'spinal-env-viewer-plugin-documentation-service';
import { NetworkService, SpinalBmsEndpoint } from 'spinal-model-bmsnetwork';
import {
  InputDataDevice,
  InputDataEndpoint,
  InputDataEndpointGroup,
  InputDataEndpointDataType,
  InputDataEndpointType,
} from '../../../model/InputData/InputDataModel/InputDataModel';
import { SpinalServiceTimeseries } from 'spinal-model-timeseries';
import { serviceTicketPersonalized, spinalServiceTicket } from 'spinal-service-ticket';
import axios, { AxiosError } from 'axios';
import { spinalOccupantService } from 'spinal-model-occupant';
import { spinalOrganizationService } from 'spinal-model-organization';
/**
 * Main purpose of this class is to handle both alarms and access logs from client.
 *
 * @export
 * @class SyncRunPull
 */
export class SyncRunPull {
  graph: SpinalGraph<any>;
  config: OrganConfigModel;
  interval: number;
  running: boolean;
  nwService: NetworkService;
  networkContext: SpinalNode<any>;
  virtualNetworkContext: SpinalNode<any>;
  timeseriesService: SpinalServiceTimeseries;
  occupantContext: SpinalNode<any>;
  organizationContext: SpinalNode<any>;
  ticketContext: SpinalNode<any>;
  ticketProcess: SpinalNode<any>;
  equipmentGroup: SpinalNode<any>;
  mappingCodeToEquipment: Map<string, SpinalNode<any>>;
  buildingNode: SpinalNode<any>;
  cpFlux4S: SpinalNode<any>;
  cpBadges4S: SpinalNode<any>;
  cpFluxLLG: SpinalNode<any>;
  cpBadgesLLG: SpinalNode<any>;
  cpFluxOPERA: SpinalNode<any>;
  cpBadgesOPERA: SpinalNode<any>;



  constructor(
    graph: SpinalGraph<any>,
    config: OrganConfigModel,
    nwService: NetworkService
  ) {
    this.graph = graph;
    this.config = config;
    this.running = false;
    this.nwService = nwService;
    this.timeseriesService = new SpinalServiceTimeseries();
  }

  async getNetworkContext(): Promise<SpinalNode<any>> {
    const contexts = await this.graph.getChildren();
    for (const context of contexts) {
      if (context.info.name.get() === process.env.NETWORK_CONTEXT_NAME) {
        // @ts-ignore
        SpinalGraphService._addNode(context);
        return context;
      }
    }
    throw new Error('Network Context Not found');
  }

  async getTicketContext(): Promise<SpinalNode<any>> {
    const contexts = await this.graph.getChildren();
    for (const context of contexts) {
      if (context.info.name.get() === process.env.TICKET_CONTEXT_NAME) {
        // @ts-ignore
        SpinalGraphService._addNode(context);
        return context;
      }
    }
    throw new Error('Ticket Context Not found');
  }

  async getTicketProcess(): Promise<SpinalNode<any>> {
    const context = await this.getTicketContext();
    const processes = await context.getChildren(
      'SpinalSystemServiceTicketHasProcess'
    );
    const ticketProcess = processes.find((proc) => {
      // @ts-ignore
      SpinalGraphService._addNode(proc);
      return proc.getName().get() === process.env.TICKET_PROCESS_NAME;
    });
    if (!ticketProcess) {
      throw new Error('Ticket Process Not found');
    }
    return ticketProcess;
  }

  async getVirtualNetwork(): Promise<SpinalNode<any>> {
    const context = await this.getNetworkContext();
    const virtualNetworks = await context.getChildren('hasBmsNetwork');
    return virtualNetworks.find((network) => {
      return network.getName().get() === process.env.VIRTUAL_NETWORK_NAME;
    });
  }

  async initEquipmentGroup(): Promise<void> {
    const contexts = await this.graph.getChildren();

    const context = contexts.find(
      (context) =>
        context.getName().get() === process.env.EQUIPMENT_CONTEXT_NAME
    );
    if (!context) {
      throw new Error('Equipment Context Not Found');
    }

    const categories = await context.getChildren('hasCategory');
    const category = categories.find((cat) => {
      return cat.getName().get() === process.env.EQUIPMENT_CATEGORY_NAME;
    });
    if (!category) {
      throw new Error('Equipment Category Not Found');
    }
    const equipmentGroups = await category.getChildren('hasGroup');
    const equipmentGroup = equipmentGroups.find((group) => {
      return group.getName().get() === process.env.EQUIPMENT_GROUP_NAME;
    });
    if (!equipmentGroup) {
      throw new Error('Equipment Group Not Found');
    }

    SpinalGraphService._addNode(equipmentGroup);
    this.equipmentGroup = equipmentGroup;

    this.mappingCodeToEquipment = new Map<string, SpinalNode<any>>();
    const equipmentNodes = await this.equipmentGroup.getChildren(
      'groupHasBIMObject'
    );
    for (const equipmentNode of equipmentNodes) {
      SpinalGraphService._addNode(equipmentNode);
      try {
        const attributes = await attributeService.getAttributesByCategory(
          equipmentNode,
          process.env.EQUIPMENT_ATTRIBUTE_CATEGORY_NAME,
          process.env.EQUIPMENT_ATTRIBUTE_NAME
        );

        if (!attributes || attributes.length != 1) {
          console.warn(
            `Equipment Node ${equipmentNode
              .getName()
              .get()} anomaly found with attribute fetching`
          );
          continue;
        }

        const code = String(attributes[0].value.get());
        this.mappingCodeToEquipment.set(code, equipmentNode);
      } catch (error) {
        console.warn(
          `Error fetching attributes for Equipment Node ${equipmentNode
            .getName()
            .get()}`
        );
      }
    }

    console.log(
      'Equipment Group initialized with',
      this.mappingCodeToEquipment.size,
      'equipment nodes'
    );
    // from this point, you can use this.equipmentGroup to access the equipment group node
  }

  async initBuildingNode(): Promise<void> {
    const contexts = await this.graph.getChildren();
    const context = contexts.find(
      (context) => context.getName().get() === "spatial"
    );
    if (!context) {
      throw new Error('Building Context Not Found');
    }
    const buildings = await context.getChildren('hasGeographicBuilding');
    const buildingNode = buildings.find((building) => {
      return building.getName().get() === process.env.SPATIAL_BUILDING_NAME;
    });
    if (!buildingNode) {
      throw new Error('Building Node Not Found');
    }
    SpinalGraphService._addNode(buildingNode);
    this.buildingNode = buildingNode;
    console.log('Building Node initialized:', buildingNode.getName().get());
  }

  async initControlPoints(): Promise<void> {
    const cpProfiles = await this.buildingNode.getChildren('hasControlPoints');
    const profile4S = cpProfiles.find((profile) => profile.getName().get() === process.env.PROFIL_CP_4S);
    const profileLLG = cpProfiles.find((profile) => profile.getName().get() === process.env.PROFIL_CP_LLG);
    const profileOPERA= cpProfiles.find((profile) => profile.getName().get() === process.env.PROFIL_CP_OPERA);
    if (!profile4S || !profileLLG || !profileOPERA) {
      throw new Error('Control Points Profiles Not Found');
    }

    const controlPoints4S = await profile4S.getChildren('hasBmsEndpoint');
    const controlPointsLLG = await profileLLG.getChildren('hasBmsEndpoint');
    const controlPointsOPERA = await profileOPERA.getChildren('hasBmsEndpoint');

    
    const cpFlux4S = controlPoints4S.find((cp) => cp.getName().get() === process.env.CP_NAME_FLUX_4S);
    const cpBadges4S = controlPoints4S.find((cp) => cp.getName().get() === process.env.CP_NAME_BADGES_4S);

    const cpFluxLLG = controlPointsLLG.find((cp) => cp.getName().get() === process.env.CP_NAME_FLUX_LLG);
    const cpBadgesLLG = controlPointsLLG.find((cp) => cp.getName().get() === process.env.CP_NAME_BADGES_LLG);

    const cpFluxOPERA = controlPointsOPERA.find((cp) => cp.getName().get() === process.env.CP_NAME_FLUX_OPERA);
    const cpBadgesOPERA = controlPointsOPERA.find((cp) => cp.getName().get() === process.env.CP_NAME_BADGES_OPERA);


    if (!cpFlux4S || !cpBadges4S || !cpFluxOPERA || !cpBadgesOPERA || !cpFluxLLG || !cpBadgesLLG) {
      console.error('Control Points not found : ', {
        cpFlux4S: cpFlux4S ? cpFlux4S.getName().get() : 'Not Found',
        cpBadges4S: cpBadges4S ? cpBadges4S.getName().get() : 'Not Found',
        cpFluxOPERA: cpFluxOPERA ? cpFluxOPERA.getName().get() : 'Not Found',
        cpBadgesOPERA: cpBadgesOPERA ? cpBadgesOPERA.getName().get() : 'Not Found',
        cpFluxLLG: cpFluxLLG ? cpFluxLLG.getName().get() : 'Not Found',
        cpBadgesLLG: cpBadgesLLG ? cpBadgesLLG.getName().get() : 'Not Found',
      });
      throw new Error('Control Points Not Found');
    }
    SpinalGraphService._addNode(cpFlux4S);
    SpinalGraphService._addNode(cpBadges4S);
    SpinalGraphService._addNode(cpFluxOPERA);
    SpinalGraphService._addNode(cpBadgesOPERA);
    SpinalGraphService._addNode(cpFluxLLG);
    SpinalGraphService._addNode(cpBadgesLLG);

    this.cpFlux4S = cpFlux4S;
    this.cpBadges4S = cpBadges4S;
    this.cpFluxLLG = cpFluxLLG;
    this.cpBadgesLLG = cpBadgesLLG;
    this.cpFluxOPERA = cpFluxOPERA;
    this.cpBadgesOPERA = cpBadgesOPERA;

    console.log('Control Points initialized:', {
      '4S': this.cpFlux4S.getName().get() + ' and ' + this.cpBadges4S.getName().get(),
      cpLLG: this.cpFluxLLG.getName().get() + ' and ' + this.cpBadgesLLG.getName().get(),
      cpOPERA: this.cpFluxOPERA.getName().get() + ' and ' + this.cpBadgesOPERA.getName().get(),
    });
  }

  async initNetworkNodes(): Promise<void> {
    const context = await this.getNetworkContext();
    const virtualNetwork = await this.getVirtualNetwork();
    this.networkContext = context;
    this.virtualNetworkContext = virtualNetwork;
  }

  private waitFct(nb: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(
        () => {
          resolve();
        },
        nb >= 0 ? nb : 0
      );
    });
  }

  /*async pullAndUpdateTickets(): Promise<void> {
    
    const context = await this.getTicketContext();
    const process = await this.getTicketProcess();


    const steps: SpinalNodeRef[] =
      await spinalServiceTicket.getStepsFromProcess(
        process.getId().get(),
        context.getId().get()
      );

    const raisedStep = steps.find((step) => {
      return step.name.get() === 'Raised';
    });

    const solvedStep = steps.find((step) => {
      return step.name.get() === 'Solved';
    })


    const raisedTickets = await spinalServiceTicket.getTicketsFromStep(
      raisedStep.id.get()
    );
    const solvedTickets = await spinalServiceTicket.getTicketsFromStep(
      solvedStep.id.get()
    );


    console.log('Current Raised Tickets:', raisedTickets.length);
    console.log('Current Solved Tickets:', solvedTickets.length);


    

    const notificationData = await getNotifications(); // Updated to fetch notifications
    console.log('Fetched notifications:', notificationData);

    for(const notification of notificationData.data) {
      const ticketInfo = {
        name : `${notification.type}-${notification.entity.asset.id}`,
        date: notification.date,
        client_name: notification.client_name,
        entity_class: notification.entity_class,
      };
      console.log('Ticket:', ticketInfo);
      


      if(!raisedTickets.find((ticket) => ticket.name.get() === ticketInfo.name)) {
        console.log('Creating ticket ...');
        const ticketNode = await spinalServiceTicket.addTicket(
          ticketInfo,
          process.getId().get(),
          context.getId().get(),
          "SpinalNode-0ba1d49d-826d-73e1-0e77-d6d8b187e357-186df7cd2a2",
          'alarm'
        );
        console.log('Ticket created:', ticketNode);
      } else {
        console.log('Ticket already exists:', ticketInfo.name);
        continue;
      }
    }

    for(const ticket of raisedTickets){
      if(!notificationData.data.find((notification) => 
        notification.type === ticket.name.get().split('-')[0] 
      && notification.entity.asset.id === parseInt(ticket.id.get().split('-')[1]))){
        console.log('Update step of ticket:', ticket.name.get());
        await spinalServiceTicket.moveTicketToNextStep(
          context.getId().get(),
          process.getId().get(),
          ticket.id.get(),
        );
      }
    }
    
  }*/

  dateToNumber(dateString: string | Date) {
    const dateObj = new Date(dateString);
    return dateObj.getTime();
  }

  async addAttributesToDevice(
    node: SpinalNode<any>,
    accessLog: AlceaLogAccess
  ) {
    await attributeService.addAttributeByCategoryName(
      node,
      'Alcea',
      'DeviceName',
      accessLog.DeviceName
    );
    await attributeService.addAttributeByCategoryName(
      node,
      'Alcea',
      'AlarmCode',
      accessLog.AlarmCode
    );
    console.log('Attributes added to device ', accessLog.PointName);
  }

  async createEndpoint(deviceId: string, name: string) {
    const context = await this.getNetworkContext();
    const endpointNodeModel = new InputDataEndpoint(
      `${name}`,
      0,
      '',
      InputDataEndpointDataType.Integer,
      InputDataEndpointType.Other
    );

    const res = new SpinalBmsEndpoint(
      endpointNodeModel.name,
      endpointNodeModel.path,
      endpointNodeModel.currentValue,
      endpointNodeModel.unit,
      InputDataEndpointDataType[endpointNodeModel.dataType],
      InputDataEndpointType[endpointNodeModel.type],
      endpointNodeModel.id
    );
    const childId = SpinalGraphService.createNode(
      { type: SpinalBmsEndpoint.nodeTypeName, name: endpointNodeModel.name },
      res
    );
    await SpinalGraphService.addChildInContext(
      deviceId,
      childId,
      context.getId().get(),
      SpinalBmsEndpoint.relationName,
      SPINAL_RELATION_PTR_LST_TYPE
    );

    const node = SpinalGraphService.getRealNode(childId);
    //await this.addEndpointAttributes(node,measure);
    return node;
  }

  async createDevice(deviceName) {
    const deviceNodeModel = new InputDataDevice(deviceName, 'device');
    //await this.nwService.updateData(deviceNodeModel);
    const device = await this.nwService.createNewBmsDevice(
      this.virtualNetworkContext.getId().get(),
      deviceNodeModel
    );
    console.log('Created device ', device.name.get());
    return device;
  }

  async updateFromAccessLogsData(logAccessDatas: AlceaLogAccessParsed[]) {
    for (const logAccess of logAccessDatas) {
      if (!logAccess.CompanyName) logAccess.CompanyName = 'Unknown';
      let deviceNodes: SpinalNode<any>[] =
        await this.virtualNetworkContext.getChildren('hasBmsDevice');
      // console.log('Log Access : ', logAccess.PointName);
      let deviceNode = deviceNodes.find(
        (deviceNode) => deviceNode.getName().get() === logAccess.PointName
      );
      if (!deviceNode) {
        const deviceInfo = await this.createDevice(logAccess.PointName);
        deviceNode = SpinalGraphService.getRealNode(deviceInfo.id.get());
        await this.createEndpoint(deviceNode.getId().get(), 'In');
        await this.createEndpoint(deviceNode.getId().get(), 'Out');
        await this.addAttributesToDevice(deviceNode, logAccess);

        // link device to equipment 
        const code = this.extractCode(logAccess.PointName);
        if(code) {  // link device to equipment 
          const equipmentNode = this.mappingCodeToEquipment.get(code);
          if (equipmentNode) {
            await equipmentNode.addChild(deviceNode, 'hasBmsDevice', SPINAL_RELATION_PTR_LST_TYPE);
            console.log(
              `Linked device ${logAccess.PointName} to equipment ${equipmentNode.getName().get()}`
            );
          }
        }
      }

      SpinalGraphService._addNode(deviceNode);

      // Look for endpoints

      const endpoints = await deviceNode.getChildren('hasBmsEndpoint');
      let endpointNodeIn = endpoints.find(
        (endpoint) => endpoint.getName().get() === 'In'
      );
      let endpointNodeOut = endpoints.find(
        (endpoint) => endpoint.getName().get() === 'Out'
      );
      if (!endpointNodeIn || !endpointNodeOut) {
        console.error('Endpoint In or Out not found');
        return;
      }
      SpinalGraphService._addNode(endpointNodeIn);
      SpinalGraphService._addNode(endpointNodeOut);

      const inElement = await endpointNodeIn.element.load();
      const outElement = await endpointNodeOut.element.load();
      const currentValueIn = inElement.currentValue.get();
      const currentValueOut = outElement.currentValue.get();

      if (logAccess.AlarmCodeMessage == 'Ouverture porte : bouton poussoir') {
        // increment Out
        // await this.nwService.setEndpointValue(
        //   endpointNodeOut.info.id.get(),
        //   currentValueOut + 1
        // );
        outElement.currentValue.set(currentValueOut + 1);
        await this.timeseriesService.insertFromEndpoint(
          endpointNodeOut.info.id.get(),
          currentValueOut + 1,
          logAccess.parsedDateTime1
        );
        console.log(
          'Incremented Out value from ',
          currentValueOut,
          'to',
          currentValueOut + 1,
          'for device',
          logAccess.PointName
        );
      } else if (logAccess.AlarmCodeMessage == 'Badge accepté') {
        inElement.currentValue.set(currentValueIn + 1);
        await this.timeseriesService.insertFromEndpoint(
          endpointNodeIn.info.id.get(),
          currentValueIn + 1,
          logAccess.parsedDateTime1
        );
        console.log(
          'Incremented In value from ',
          currentValueIn,
          'to',
          currentValueIn + 1,
          'for device',
          logAccess.PointName
        );
      }
    }
  }

  async updateOccupantDataFromAccessLogs(
    logAccessDatas: AlceaLogAccessParsed[]
  ) {
    const occupantNodes = await spinalOccupantService.getOccupants(
      this.occupantContext.getName().get()
    );
    const occupantList = occupantNodes.map((occupant) =>
      occupant.getName().get()
    );

    for (const logAccess of logAccessDatas) {
      if (logAccess.AlarmCodeMessage !== 'Badge accepté') continue;
      if (!occupantList.includes(logAccess.IdentifierInfo)) {
        await spinalOccupantService.addOccupant(
          {
            first_name: logAccess.FirstName,
            last_name: logAccess.LastName,
            occupantId: logAccess.IdentifierInfo,
            email: '',
            serviceName: logAccess.ServiceName,
            companyName: logAccess.CompanyName,
            phoneNumber: '',
          },
          this.occupantContext.getName().get()
        );
        occupantList.push(logAccess.IdentifierInfo);
      }
    }
  }

  async updateOrganizationDataFromAccessLogs(
    logAccessDatas: AlceaLogAccessParsed[]
  ) {
    for (const logAccess of logAccessDatas) {
      const organizationNodes =
        await spinalOrganizationService.getOrganizations(
          this.organizationContext.getName().get()
        );
      if (logAccess.AlarmCodeMessage !== 'Badge accepté') continue;
      if (!logAccess.CompanyName) logAccess.CompanyName = 'Unknown';

      let organizationNode = organizationNodes.find(
        (org) => org.getName().get() === logAccess.CompanyName
      );

      if (!organizationNode) {
        organizationNode =
          await spinalOrganizationService.addOrganizationToContext(
            {
              organizationName: logAccess.CompanyName,
              organizationId: logAccess.CompanyName,
            },
            this.organizationContext.getName().get()
          );
      }

      const occupantNodes =
        await spinalOrganizationService.getOrganizationOccupants(
          organizationNode
        );
      const linkedOccupantNode = occupantNodes.find((occupantNode) => {
        return occupantNode.getName().get() === logAccess.IdentifierInfo;
      });

      if (!linkedOccupantNode) {
        //récupérer la node occupant
        const occupantNode = await spinalOccupantService.getOccupant(
          this.occupantContext.getName().get(),
          logAccess.IdentifierInfo
        );
        await spinalOrganizationService.addOccupantToOrganization(
          occupantNode,
          organizationNode,
          this.organizationContext
        );
        console.log(
          `Added occupant ${logAccess.IdentifierInfo} to organization ${logAccess.CompanyName}`
        );
      }
    }
  }

  async doNetworkJob() {
    console.log('Getting asset information...');
    const startTime = Date.now();
    const accessLogs = await getAccessLogs();
    console.log(
      'Most Recent Log :',
      accessLogs.CollectionsContainer[0][0].parsedDateTime1
    );
    const fetchTime = (Date.now() - startTime) / 1000;
    console.log(`Access logs received in ${fetchTime} seconds`);

    const lastSyncTime = this.config.lastSync.get(); // epoch millis

    // Filter out previously synced logs
    const newLogs = accessLogs.CollectionsContainer[0]
      .filter((log) => {
        const logMoment = moment(log.parsedDateTime1.getTime());
        const today = moment();
        //if(logMoment.isSame(today, 'day')) console.log('Log Date :', logMoment.format('YYYY-MM-DD HH:mm:ss'));

        return (
          log.parsedDateTime1 &&
          log.parsedDateTime1.getTime() > lastSyncTime &&
          logMoment.isSame(today, 'day')
        );
      })
      .reverse();

    console.log(
      `After filter : Kept ${newLogs.length} logs out of ${accessLogs.CollectionsContainer[0].length} total`
    );

    this.updateOccupantDataFromAccessLogs(newLogs);
    this.updateOrganizationDataFromAccessLogs(newLogs);

    console.log('Updating data ...');
    const updateStartTime = Date.now();
    await this.updateFromAccessLogsData(newLogs); // Update to use newLogs
    const updateTime = (Date.now() - updateStartTime) / 1000;
    console.log(`Access logs data updated in ${updateTime} seconds`);
  }

  extractCode(input: string): string | null {
    const match = input.match(/LB[ES]_N°\d+/);
    if (match) {
      const code = match[0].replace('LBS', 'LBE').replace('_', ' ');
      return code;
    }
    return null;
  }

  async pullAndUpdateAlarms(): Promise<void> {
    const alarmLogs = await getAlarmLogs();
    console.log(
      'Most Recent Alarm Log :',
      alarmLogs.CollectionsContainer[0][0].parsedDateTime1
    );
    const lastSyncTime = this.config.lastSync.get(); // epoch millis
    // Filter out previously synced logs
    const newAlarmLogs = alarmLogs.CollectionsContainer[0]
      .filter((log) => {
        return (
          log.parsedDateTime1 &&
          log.parsedDateTime1.getTime() > lastSyncTime &&
          log.AlarmCodeMessage !== "Changement d'état normal" &&
          log.AlarmCodeMessage !== "Changement d'état alarme" &&
          log.AlarmCodeMessage !== "Porte fermée"
        );
      })
      .reverse();

    console.log(
      `After filter : Kept ${newAlarmLogs.length} alarm logs out of ${alarmLogs.CollectionsContainer[0].length} total`
    );

    for (const logAlarm of newAlarmLogs) {
      const code = this.extractCode(logAlarm.PointName); //  LBS_N° is also converted to LBE_N°,
      if(!code) { // The log does not have LBE_N° or LBS_N°
        console.warn(
          `No code found in PointName: ${logAlarm.PointName}. Skipping alarm log.`
        );
        continue;
      }

      const ticketInfo = {
        name : `${code}-${logAlarm.AlarmCodeMessage}`,
        date: logAlarm.parsedDateTime1,
        clientName: 'alcea',
        AlarmID: logAlarm.AlarmID,
        AlarmCode: logAlarm.AlarmCode,

      }

      const equipmentNode = this.mappingCodeToEquipment.get(code);
      if (!equipmentNode) { // We don't have any equipment that match the LBE_N°
        // in this case, we link to building node
        console.warn(
          `Equipment node not found for code: ${code}. Linking to building node.`
        );
        if (!this.buildingNode) {
          console.error('Building node not initialized. Cannot link ticket.');
          continue;
        }
        await serviceTicketPersonalized.addTicket(ticketInfo, this.ticketProcess.getId().get(),
          this.ticketContext.getId().get(), this.buildingNode.getId().get());
      }
      else {
        await serviceTicketPersonalized.addTicket(ticketInfo, this.ticketProcess.getId().get(),
          this.ticketContext.getId().get(), equipmentNode.getId().get());
      }
      
    }
    console.log('Alarm tickets processed successfully.');
  }



  async calculateOccupants(): Promise<void> {
    //In this function, we try to calculate the number of occupants in the building in different ways
    // 1-  Add and substract in and outs of specific devices for each building
    // 2-  Count the number of badges scanned daily

    // 1 :
    const deviceNumbersOPERA = process.env.LBE_OPERA.split(',');
    const deviceNumbersLLG = process.env.LBE_LLG.split(',');
    // const deviceNumbers4S = process.env.LBE_4S.split(',');
    console.log(
      'Device Numbers for OPERA:',
      deviceNumbersOPERA,
      'LLG:',
      deviceNumbersLLG,
      // '4S:',
      // deviceNumbers4S
    );

    const deviceNamesIn4S = process.env.IN_4S.split(',');
    const deviceNamesOut4S = process.env.OUT_4S.split(',');


    const deviceNodes: SpinalNode<any>[] =
      await this.virtualNetworkContext.getChildren('hasBmsDevice');

    let totalOccupantsOPERA = 0;
    let totalOccupantsLLG = 0;
    let totalOccupants4S = 0;
    let totalOccupants = 0;

    for (const deviceNode of deviceNodes) {
      const deviceName = deviceNode.getName().get();
      const endpoints = await deviceNode.getChildren('hasBmsEndpoint');
      const inEndpoint = endpoints.find(
        (endpoint) => endpoint.getName().get() === 'In'
      );
      const outEndpoint = endpoints.find(
        (endpoint) => endpoint.getName().get() === 'Out'
      );
      if (!inEndpoint || !outEndpoint) {
        console.error(
          'In or Out endpoint not found for device',
          deviceNode.getName().get()
        );
        continue;
      }
      const inElement = await inEndpoint.element.load();
      const outElement = await outEndpoint.element.load();
      const inValue = inElement.currentValue.get();
      const outValue = outElement.currentValue.get();
      totalOccupants +=
      inValue - outValue;

     
      if( deviceNumbersOPERA.some((deviceNumber) => deviceName.includes(deviceNumber))){
        console.log(
          `Device OPERA: ${deviceName}, In: ${inValue}, Out: ${outValue}, Difference: ${inValue - outValue}`
        );
        totalOccupantsOPERA += inValue - outValue;
      }
      else if( deviceNumbersLLG.some((deviceNumber) => deviceName.includes(deviceNumber))){
        console.log(
          `Device LLG: ${deviceName}, In: ${inValue}, Out: ${outValue}, Difference: ${inValue - outValue}`
        );
        totalOccupantsLLG += inValue - outValue;
      }
      else if( deviceNamesIn4S.some((deviceNameIn) => deviceName == deviceNameIn )){
        console.log(
          `Device 4S IN: ${deviceName}, In: ${inValue}`
        );
        totalOccupants4S += inValue;
      }

      else if( deviceNamesOut4S.some((deviceNameOut) => deviceName == deviceNameOut )){
        console.log(
          `Device 4S OUT: ${deviceName}, In: ${inValue}`
        );
        totalOccupants4S +=  -inValue; // If it's an Out device, we subtract the In value from the Out value
      }
    }

    console.log(
      'Occupants calculated from In/Out endpoints:',
     {'OPERA': totalOccupantsOPERA, 'LLG': totalOccupantsLLG, '4S': totalOccupants4S, 'Total': totalOccupants}
    );

    const cpFluxOperaModel = await this.cpFluxOPERA.element.load();
    const cpBadgesOperaModel = await this.cpBadgesOPERA.element.load();
    const cpFluxLLGModel = await this.cpFluxLLG.element.load();
    const cpBadgesLLGModel = await this.cpBadgesLLG.element.load();
    const cpFlux4SModel = await this.cpFlux4S.element.load();
    const cpBadges4SModel = await this.cpBadges4S.element.load();

    cpFluxOperaModel.currentValue.set(totalOccupantsOPERA);
    cpFluxLLGModel.currentValue.set(totalOccupantsLLG);
    cpFlux4SModel.currentValue.set(totalOccupants4S);
    
    await this.timeseriesService.pushFromEndpoint(
      this.cpFluxOPERA.info.id.get(),
      totalOccupantsOPERA,
    );
    await this.timeseriesService.pushFromEndpoint(
      this.cpFluxLLG.info.id.get(),
      totalOccupantsLLG,
    );
    await this.timeseriesService.pushFromEndpoint(
      this.cpFlux4S.info.id.get(),
      totalOccupants4S,
    );
    console.log(
      'Control Points updated with total occupants from In/Out endpoints'
    );

    // 2 :
    const occupantNodes = await spinalOccupantService.getOccupants(
      this.occupantContext.getName().get()
    );
    const totalOccupantsFromBadges = occupantNodes.length;

    cpBadgesOperaModel.currentValue.set(totalOccupantsFromBadges);
    cpBadgesLLGModel.currentValue.set(totalOccupantsFromBadges);
    cpBadges4SModel.currentValue.set(totalOccupantsFromBadges);

    console.log(
      'Total occupants calculated from badges:',
      totalOccupantsFromBadges
    );
  }

  async resetIfNeeded(): Promise<void> {
    if (this.config.lastSync.get() === 0) return;
    const lastSyncDate = moment(this.config.lastSync.get());
    const today = moment();
    if (lastSyncDate.isSame(today, 'day')) {
      return;
    }
    console.log('Resetting endpoint values to 0');
    const deviceNodes: SpinalNode<any>[] =
      await this.virtualNetworkContext.getChildren('hasBmsDevice');
    for (const deviceNode of deviceNodes) {
      const endpoints = await deviceNode.getChildren('hasBmsEndpoint');
      for (const endpoint of endpoints) {
        const element = await endpoint.element.load();
        element.currentValue.set(0);
        //await this.nwService.setEndpointValue(endpoint.info.id.get(), 0);
      }
    }
    console.log('Endpoint values reset to 0 successfully');
    console.log('Cleaning known daily occupants...');

    await spinalOccupantService.deleteAllOccupants(
      this.occupantContext.getName().get()
    );
  }

  async initTicketNodes(): Promise<void> {
    this.ticketContext = await this.getTicketContext();
    this.ticketProcess = await this.getTicketProcess();
  }

  async init(): Promise<void> {
    console.log('Initiating SyncRunPull');
    try {
      await this.initEquipmentGroup(); // for tickets and bmsdevices link 
      await this.initTicketNodes();
      await this.initBuildingNode();
      await this.initControlPoints();

      this.occupantContext = await spinalOccupantService.createOrGetContext(process.env.OCCUPANT_CONTEXT_NAME);
      this.organizationContext = await spinalOrganizationService.createOrGetContext(process.env.ORGANIZATION_CONTEXT_NAME);
      await this.initNetworkNodes();
      await this.resetIfNeeded();
      await this.doNetworkJob();
      await this.calculateOccupants();
      await this.pullAndUpdateAlarms();
      
      console.log('SyncRunPull initiated successfully');

      this.config.lastSync.set(Date.now());
    } catch (e) {
      axios.isAxiosError(e) ? console.error('[AxiosError]') : console.error(e);
    }
  }

  async run(): Promise<void> {
    this.running = true;
    const timeout = parseInt(process.env.PULL_INTERVAL);
    await this.waitFct(timeout);
    while (true) {
      if (!this.running) break;
      const before = Date.now();
      try {
        await this.resetIfNeeded();
        await this.doNetworkJob();
        await this.calculateOccupants();
        await this.pullAndUpdateAlarms();
        this.config.lastSync.set(Date.now());
      } catch (e) {
        axios.isAxiosError(e)
          ? console.error('[AxiosError]')
          : console.error(e);
        await this.waitFct(1000 * 60);
      } finally {
        const delta = Date.now() - before;
        const timeout = parseInt(process.env.PULL_INTERVAL) - delta;
        await this.waitFct(timeout);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
export default SyncRunPull;
