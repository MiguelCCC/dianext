/**
 * Modelo único para representar cada resultado procesado por la extensión.
 * @typedef {Object} ResultModel
 * @property {string} cufe - CUFE consultado.
 * @property {string} numeroFactura - Número de factura asociado al CUFE.
 * @property {string} valorFactura - Valor total de la factura.
 * @property {string} numeroNotaCredito - Número de la nota de crédito, si aplica.
 * @property {string} valorNotaCredito - Valor total de la nota de crédito, si aplica.
 * @property {string} estado - Estado del procesamiento del registro.
 * @property {string} error - Descripción del error, si existe.
 */
class ResultModel {
  /**
   * @param {object} [data={}]
   * @param {string} [data.cufe='']
   * @param {string} [data.numeroFactura='']
   * @param {string} [data.valorFactura='']
   * @param {string} [data.numeroNotaCredito='']
   * @param {string} [data.valorNotaCredito='']
   * @param {string} [data.estado='']
   * @param {string} [data.error='']
   */
  constructor(data = {}) {
    this.cufe = data.cufe || '';
    this.numeroFactura = data.numeroFactura || '';
    this.valorFactura = data.valorFactura || '';
    this.numeroNotaCredito = data.numeroNotaCredito || '';
    this.valorNotaCredito = data.valorNotaCredito || '';
    this.estado = data.estado || '';
    this.error = data.error || '';
  }
}

export default ResultModel;
